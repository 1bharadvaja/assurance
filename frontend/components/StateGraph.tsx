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
  Idle: { x: 40, y: 100 },
  Armed: { x: 190, y: 100 },
  Mission: { x: 350, y: 100 },
  DegradedComms: { x: 530, y: 100 },
  Actuate: { x: 720, y: 100 },
  Recovery: { x: 400, y: 230 },
  EmergencyLand: { x: 560, y: 230 },
};

function fallbackLayout(id: string, index: number) {
  if (LAYOUT[id]) return LAYOUT[id];
  return { x: 60 + (index % 5) * 180, y: 100 + Math.floor(index / 5) * 130 };
}

export function StateGraph({ nodes, edges, counterexample, culpritName }: Props) {
  const hasCounterexample = !!counterexample && counterexample.length > 1;

  const { rfNodes, rfEdges } = useMemo(() => {
    const pathList = hasCounterexample ? pathEdges(counterexample!) : [];
    const pathOrder = new Map<string, number>();
    pathList.forEach((p, i) => {
      pathOrder.set(`${p.transition}|${p.source}|${p.target}`, i + 1);
    });
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

      let background = "#ffffff";
      let borderColor = "#d8dde6";
      let color = "#1a1f29";
      if (isFinal) {
        background = "#fdecec";
        borderColor = "#dc2626";
        color = "#7f1d1d";
      } else if (onPath) {
        background = "#eef4ff";
        borderColor = "#2563eb";
        color = "#1e3a8a";
      }
      const opacity = hasCounterexample && !onPath ? 0.4 : 1;

      return {
        id: n.id,
        position: pos,
        data: { label: n.label },
        style: {
          background,
          border: `1px solid ${borderColor}`,
          color,
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: 12,
          width: 122,
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

        let stroke = "#c2c9d6";
        let strokeWidth = 1;
        let label = e.label;
        let opacity = 1;
        let labelTone = "#94a0b4";

        if (hasCounterexample && !onPath) opacity = 0.25;

        if (onPath) {
          stroke = isCulprit ? "#dc2626" : "#2563eb";
          strokeWidth = isCulprit ? 2 : 1.5;
          label = `${order}. ${isCulprit ? "unsafe actuation" : e.label}`;
          labelTone = isCulprit ? "#7f1d1d" : "#1e3a8a";
        } else if (isCulprit) {
          stroke = "#dc2626";
          strokeWidth = 1.5;
          label = "unsafe actuation";
          labelTone = "#7f1d1d";
        }

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label,
          animated: false,
          style: { stroke, strokeWidth, opacity },
          labelStyle: { fill: labelTone, fontFamily: "JetBrains Mono", fontSize: 10 },
          labelBgStyle: { fill: "#fbfbfd", fillOpacity: 0.95 },
          labelBgPadding: [3, 1.5] as [number, number],
          labelBgBorderRadius: 3,
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        };
      });

    return { rfNodes, rfEdges };
  }, [nodes, edges, counterexample, culpritName, hasCounterexample]);

  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-line pb-2">
        <h3 className="text-[14px] font-semibold tracking-tight text-ink-900">
          State graph
        </h3>
        <span className="text-[11px] text-ink-400">
          {hasCounterexample
            ? "Highlighted path found by the checker."
            : "Controller modes and transitions."}
        </span>
      </div>
      <div className="mt-3 h-[300px] rounded border border-line bg-paper">
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
          <Background color="#eef0f4" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
