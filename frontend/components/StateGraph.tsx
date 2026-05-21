"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  MarkerType,
} from "reactflow";
import type { GraphEdge, GraphNode, TraceStep } from "../lib/types";

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  counterexample?: TraceStep[] | null;
  culpritName?: string | null;
}

// Hand-tuned layout for the seven mission-controller modes.
const LAYOUT: Record<string, { x: number; y: number }> = {
  Idle: { x: 40, y: 120 },
  Armed: { x: 200, y: 120 },
  Mission: { x: 380, y: 120 },
  DegradedComms: { x: 580, y: 120 },
  Actuate: { x: 780, y: 120 },
  Recovery: { x: 420, y: 280 },
  EmergencyLand: { x: 600, y: 280 },
};

function fallbackLayout(id: string, index: number) {
  if (LAYOUT[id]) return LAYOUT[id];
  return { x: 60 + (index % 5) * 180, y: 120 + Math.floor(index / 5) * 160 };
}

export function StateGraph({ nodes, edges, counterexample, culpritName }: Props) {
  const { rfNodes, rfEdges } = useMemo(() => {
    // Build a set of edges traversed by the counterexample.
    const cePath = new Set<string>();
    if (counterexample && counterexample.length > 1) {
      for (let i = 0; i < counterexample.length - 1; i++) {
        const cur = counterexample[i];
        const nxt = counterexample[i + 1];
        const trans = cur.transition;
        const src = cur.mode as string;
        const dst = nxt.mode as string;
        if (typeof trans === "string" && trans !== "stutter" && src && dst) {
          cePath.add(`${trans}|${src}|${dst}`);
        }
      }
    }
    const cePathTransitions = new Set(
      Array.from(cePath).map((k) => k.split("|")[0])
    );
    const finalMode = counterexample?.[counterexample.length - 1]?.mode as
      | string
      | undefined;

    const rfNodes: Node[] = nodes.map((n, i) => {
      const pos = fallbackLayout(n.id, i);
      const onCePath = counterexample?.some((step) => step.mode === n.id) ?? false;
      const isFinal = finalMode === n.id;
      const bg = isFinal
        ? "#3a0d18"
        : onCePath
        ? "#251525"
        : "#1a1f29";
      const border = isFinal
        ? "#f43f5e"
        : onCePath
        ? "#7c3aed"
        : "#2c333f";
      return {
        id: n.id,
        position: pos,
        data: { label: n.label },
        style: {
          background: bg,
          border: `1px solid ${border}`,
          color: "#eef0f4",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 13,
          width: 130,
          textAlign: "center" as const,
        },
      };
    });

    const rfEdges: Edge[] = edges.map((e) => {
      const onPath = cePath.has(`${e.label}|${e.source}|${e.target}`);
      const isCulprit = culpritName === e.label;
      const isReactive = e.reactive;
      // visual hierarchy: culprit > onPath > reactive > normal
      const stroke = isCulprit
        ? "#f43f5e"
        : onPath
        ? "#a855f7"
        : isReactive
        ? "#0ea5e9"
        : "#414957";
      const strokeWidth = isCulprit ? 2.5 : onPath ? 2 : 1.2;
      const labelTone = isCulprit
        ? "#fecdd3"
        : onPath
        ? "#e9d5ff"
        : isReactive
        ? "#bae6fd"
        : "#bcc4d3";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: onPath || isCulprit,
        style: { stroke, strokeWidth },
        labelStyle: { fill: labelTone, fontFamily: "JetBrains Mono", fontSize: 10 },
        labelBgStyle: { fill: "#070b12", fillOpacity: 0.95 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        type: e.source === e.target ? "default" : undefined,
      };
    });

    // Filter edges drawn in the graph to only those that involve the mode
    // changes; we drop the spurious self-loops the backend may have emitted
    // for transitions whose source we could not infer.
    const filtered = rfEdges.filter((e) => e.source !== e.target);
    void cePathTransitions; // reserved for future tooltips
    return { rfNodes, rfEdges: filtered };
  }, [nodes, edges, counterexample, culpritName]);

  return (
    <section id="state-graph">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-ink-100">Controller state graph</h3>
        <span className="text-xs text-ink-400">
          Nodes are modes; edges are transitions. Reactive transitions in blue, counterexample path in violet, culprit in rose.
        </span>
      </div>
      <div className="h-[420px] rounded-xl border border-ink-800 bg-ink-900/40">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll={false}
          zoomOnPinch
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1a1f29" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}
