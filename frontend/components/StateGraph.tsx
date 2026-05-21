"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  MarkerType,
} from "reactflow";
import { pathEdges } from "../lib/narrative";
import type { GraphEdge, GraphNode, TraceStep } from "../lib/types";

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  counterexample?: TraceStep[] | null;
  culpritName?: string | null;
}

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
  const hasCounterexample = !!counterexample && counterexample.length > 1;

  const { rfNodes, rfEdges, caption } = useMemo(() => {
    // Build numbered edges from the counterexample.
    const pathList = hasCounterexample ? pathEdges(counterexample!) : [];
    const pathOrder = new Map<string, number>();
    pathList.forEach((p, i) => {
      pathOrder.set(`${p.transition}|${p.source}|${p.target}`, i + 1);
    });
    const pathTransitions = new Set(pathList.map((p) => p.transition));
    const finalMode = counterexample?.[counterexample.length - 1]?.mode as
      | string
      | undefined;
    const onPathNodeIds = new Set<string>(
      pathList.flatMap((p) => [p.source, p.target])
    );
    if (counterexample) {
      for (const s of counterexample) {
        if (s.mode) onPathNodeIds.add(s.mode as string);
      }
    }

    const rfNodes: Node[] = nodes.map((n, i) => {
      const pos = fallbackLayout(n.id, i);
      const onPath = hasCounterexample && onPathNodeIds.has(n.id);
      const isFinal = finalMode === n.id;
      const bg = isFinal
        ? "#3a0d18"
        : onPath
        ? "#1f1a2a"
        : "#1a1f29";
      const border = isFinal
        ? "#f43f5e"
        : onPath
        ? "#7c3aed"
        : "#2c333f";
      const opacity = hasCounterexample && !onPath ? 0.35 : 1;
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
          opacity,
        },
      };
    });

    const rfEdges: Edge[] = edges
      .filter((e) => e.source !== e.target)
      .map((e) => {
        const order = pathOrder.get(`${e.label}|${e.source}|${e.target}`);
        const onPath = order !== undefined;
        const isCulprit = culpritName === e.label;

        let stroke = "#414957";
        let strokeWidth = 1.2;
        let label = e.label;
        let opacity = 1;
        let labelTone = "#bcc4d3";

        if (hasCounterexample) {
          // Fade non-path edges to focus the eye on the violation chain.
          if (!onPath) {
            opacity = 0.18;
          }
        }

        if (e.reactive && !onPath && !isCulprit) {
          stroke = "#0ea5e9";
          labelTone = "#bae6fd";
        }

        if (onPath) {
          stroke = isCulprit ? "#f43f5e" : "#a855f7";
          strokeWidth = isCulprit ? 2.8 : 2;
          label = `${order}. ${isCulprit ? "unsafe actuation" : e.label}`;
          labelTone = isCulprit ? "#fecdd3" : "#e9d5ff";
        } else if (isCulprit) {
          stroke = "#f43f5e";
          strokeWidth = 2.5;
          label = `unsafe actuation`;
          labelTone = "#fecdd3";
        }

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label,
          animated: onPath || isCulprit,
          style: { stroke, strokeWidth, opacity },
          labelStyle: { fill: labelTone, fontFamily: "JetBrains Mono", fontSize: 10 },
          labelBgStyle: { fill: "#070b12", fillOpacity: 0.95 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        };
      });

    void pathTransitions;
    const caption = hasCounterexample
      ? "The verifier found this reachable path through the controller. Each numbered edge is a step in the unsafe execution."
      : "Controller states and transitions. Reactive transitions in blue.";

    return { rfNodes, rfEdges, caption };
  }, [nodes, edges, counterexample, culpritName, hasCounterexample]);

  return (
    <div>
      <p className="mb-3 text-sm text-ink-300">{caption}</p>
      <div className="h-[380px] rounded-xl border border-ink-800 bg-ink-900/40">
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
    </div>
  );
}
