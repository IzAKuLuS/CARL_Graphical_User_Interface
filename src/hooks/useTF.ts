"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { useROS } from "./useROS";
import { LEGACY_TOPICS } from "@/lib/rosTopics";

interface TransformStamped {
  header: {
    frame_id: string;
    stamp: { secs: number; nsecs: number };
  };
  child_frame_id: string;
  transform: {
    translation: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  };
}

interface TFMessage {
  transforms: TransformStamped[];
}

interface StoredTransform {
  parent: string;
  translation: THREE.Vector3;
  rotation: THREE.Quaternion;
  stamp: number; // ms since epoch, for staleness checks
}

export interface ResolvedPose {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

const MAX_CHAIN_DEPTH = 32; // guard against cycles

/**
 * Subscribe to /tf (shared topic — all robots publish here after the
 * shared-tf remap in ros-entrypoint.sh) and provide helpers to resolve
 * a frame's world pose by walking its parent chain.
 *
 * Usage:
 *   const tf = useTF();
 *   const pose = tf.getPose('tb3_2/base_link');
 *   if (pose) drawMarker(pose.position);
 */
export function useTF() {
  const { subscribe, isConnected } = useROS();

  // Mutable store of transforms keyed by child_frame_id.
  // Using a ref (not state) because high-frequency TF updates would
  // re-render every consumer 30+ times per second otherwise.
  const transformsRef = useRef<Map<string, StoredTransform>>(new Map());

  useEffect(() => {
    if (!isConnected) return;

    const handleTF = (msg: TFMessage) => {
      if (!msg.transforms) return;
      const now = Date.now();

      for (const t of msg.transforms) {
        const translation = new THREE.Vector3(
          t.transform.translation.x,
          t.transform.translation.y,
          t.transform.translation.z,
        );
        const rotation = new THREE.Quaternion(
          t.transform.rotation.x,
          t.transform.rotation.y,
          t.transform.rotation.z,
          t.transform.rotation.w,
        );

        transformsRef.current.set(t.child_frame_id, {
          parent: t.header.frame_id,
          translation,
          rotation,
          stamp: now,
        });
      }
    };

    // Note: no robotId argument — /tf is a shared topic.
    const unsubTf = subscribe<TFMessage>(
      LEGACY_TOPICS.tf.path,
      LEGACY_TOPICS.tf.type,
      handleTF,
    );
    const unsubTfStatic = subscribe<TFMessage>(
      LEGACY_TOPICS.tfStatic.path,
      LEGACY_TOPICS.tfStatic.type,
      handleTF,
    );

    return () => {
      unsubTf();
      unsubTfStatic();
    };
  }, [isConnected, subscribe]);

  /**
   * Look up the stored transform for a single frame (no chain walking).
   * Returns null if the frame hasn't been seen yet.
   */
  const getTransform = useCallback((frameId: string) => {
    return transformsRef.current.get(frameId) ?? null;
  }, []);

  /**
   * Resolve a frame's pose by walking up the parent chain and composing
   * every transform along the way. Returns null if the chain is broken
   * (some intermediate frame hasn't been published yet) or if the root
   * frame is unreachable.
   *
   * @param frameId  The frame whose world pose you want.
   * @param rootFrame Optional explicit root (e.g. 'world', 'map').
   *                  Default: walk until a frame with no known parent.
   */
  const getPose = useCallback(
    (frameId: string, rootFrame?: string): ResolvedPose | null => {
      const store = transformsRef.current;

      // Accumulate position and rotation as we walk up.
      const accumPos = new THREE.Vector3(0, 0, 0);
      const accumRot = new THREE.Quaternion(0, 0, 0, 1);

      let current = frameId;
      let depth = 0;

      while (depth < MAX_CHAIN_DEPTH) {
        // Stop conditions
        if (rootFrame && current === rootFrame) break;

        const t = store.get(current);
        if (!t) {
          // Reached a frame with no known transform — treat as root if no
          // rootFrame was specified, otherwise the chain is broken.
          if (rootFrame === undefined) break;
          return null;
        }

        // Compose: world_pose = parent_transform * child_pose
        // i.e. rotate the accumulated translation by the parent's rotation,
        // then add the parent's translation.
        accumPos.applyQuaternion(t.rotation);
        accumPos.add(t.translation);
        accumRot.premultiply(t.rotation);

        current = t.parent;
        depth++;
      }

      if (depth >= MAX_CHAIN_DEPTH) {
        console.warn(`[useTF] chain depth exceeded for ${frameId} — cycle?`);
        return null;
      }

      return {
        position: { x: accumPos.x, y: accumPos.y, z: accumPos.z },
        rotation: {
          x: accumRot.x,
          y: accumRot.y,
          z: accumRot.z,
          w: accumRot.w,
        },
      };
    },
    [],
  );

  /**
   * Get the list of currently-known frame IDs. Useful for debugging
   * and for consumers that want to enumerate all robots' frames.
   */
  const getKnownFrames = useCallback((): string[] => {
    return Array.from(transformsRef.current.keys());
  }, []);

  return { getPose, getTransform, getKnownFrames };
}

export default useTF;
