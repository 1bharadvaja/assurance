"use client";

import { useMemo, memo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  Node,
  MarkerType,
  NodeProps,
  Position,
} from "reactflow";
import { pathEdges } from "../lib/narrative";
import type { GraphEdge, GraphNode, TraceStep } from "../lib/types";

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  counterexample?: TraceStep[] | null;
  culpritName?: string | null;
}

/**
 * Two-row layout. Top row is the mission line; Recovery / EmergencyLand
 * sit directly under Mission / DegradedComms so the cross-cutting
 * low_battery_recovery edges land cleanly.
 */
const LAYOUT: Record<string, { x: number; y: number }> = {
  Idle: { x: 10, y: 40 },
  Armed: { x: 200, y: 40 },
  Mission: { x: 390, y: 40 },
  DegradedComms: { x: 580, y: 40 },
  Actuate: { x: 770, y: 40 },
  Recovery: { x: 390, y: 250 },
  EmergencyLand: { x: 580, y: 250 },
};

const NODE_WIDTH = 124;
const NODE_HEIGHT = 30;

// Compact display labels for the transitions that appear on the graph.
// The replay timeline above the graph carries the full transition names,
// so we can keep these terse and let them fit inside the inter-node gaps
// without clipping under the node boxes.
const SHORT_LABEL: Record<string, string> = {
  arm: "arm",
  start_mission: "start",
  comms_degrade: "degrade",
  authorized_actuation: "actuate",
  low_battery_recovery: "low batt",
  emergency_land: "land",
};
function shortLabel(name: string): string {
  return SHORT_LABEL[name] ?? name;
}

/**
 * Custom node with explicit handles on all four sides so we can route each
 * edge from / to the natural face (horizontal between top-row neighbors,
 * vertical for the down branch into Recovery, etc.) instead of letting
 * React Flow's auto-pick spit edges out of awkward corners.
 */
type ModeNodeData = {
  label: string;
  background: string;
  borderColor: string;
  color: string;
  opacity: number;
};

const ModeNode = memo(function ModeNode({ data }: NodeProps<ModeNodeData>) {
  return (
    <div
      style={{
        background: data.background,
        border: `1px solid ${data.borderColor}`,
        borderRadius: 6,
        padding: "5px 10px",
        fontSize: 11.5,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        color: data.color,
        textAlign: "center",
        opacity: data.opacity,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <HandleHidden id="tl" type="target" position={Position.Left} />
      <HandleHidden id="tt" type="target" position={Position.Top} />
      <HandleHidden id="sr" type="source" position={Position.Right} />
      <HandleHidden id="sb" type="source" position={Position.Bottom} />
      <span>{data.label}</span>
    </div>
  );
});

function HandleHidden({
  id,
  type,
  position,
}: {
  id: string;
  type: "source" | "target";
  position: Position;
}) {
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      style={{
        opacity: 0,
        background: "transparent",
        border: 0,
        width: 1,
        height: 1,
        pointerEvents: "none",
      }}
      isConnectable={false}
    />
  );
}

const nodeTypes = { mode: ModeNode };

function pickHandles(srcId: string, tgtId: string) {
  const a = LAYOUT[srcId];
  const b = LAYOUT[tgtId];
  if (!a || !b) return { sourceHandle: "sr", targetHandle: "tl" };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Same horizontal row: leave from the right, enter from the left.
  if (Math.abs(dy) < 30) return { sourceHandle: "sr", targetHandle: "tl" };
  // Otherwise the edge drops a row: leave from the bottom, enter from the top.
  return { sourceHandle: "sb", targetHandle: "tt" };
}

function fallbackLayout(id: string, index: number) {
  if (LAYOUT[id]) return LAYOUT[id];
  return { x: 30 + (index % 5) * 180, y: 40 + Math.floor(index / 5) * 210 };
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
      const opacity = hasCounterexample && !onPath ? 0.45 : 1;
      return {
        id: n.id,
        type: "mode",
        position: pos,
        data: { label: n.label, background, borderColor, color, opacity },
      };
    });

    type Pending = {
      edge: Edge;
      key: string;
      onPath: boolean;
      isCulprit: boolean;
    };
    const pending: Pending[] = edges
      .filter((e) => e.source !== e.target)
      .map((e) => {
        const order = pathOrder.get(`${e.label}|${e.source}|${e.target}`);
        const onPath = order !== undefined;
        const isCulprit = culpritName === e.label;

        let stroke = "#c8cfdb";
        let strokeWidth = 1;
        let opacity = 1;
        let labelTone = "#7b8597";
        let label: string = e.label;

        if (hasCounterexample && !onPath) opacity = 0.2;

        if (onPath) {
          stroke = isCulprit ? "#dc2626" : "#2563eb";
          strokeWidth = isCulprit ? 2 : 1.5;
          label = `${order}. ${isCulprit ? "unsafe" : shortLabel(e.label)}`;
          labelTone = isCulprit ? "#7f1d1d" : "#1e3a8a";
        } else if (isCulprit) {
          stroke = "#dc2626";
          strokeWidth = 1.5;
          label = "unsafe";
          labelTone = "#7f1d1d";
        } else {
          label = shortLabel(e.label);
        }

        const handles = pickHandles(e.source, e.target);
        const rfEdge: Edge = {
          id: e.id,
          source: e.source,
          target: e.target,
          ...handles,
          type: "straight",
          label,
          animated: false,
          style: { stroke, strokeWidth, opacity },
          labelStyle: {
            fill: labelTone,
            fontFamily: "JetBrains Mono",
            fontSize: 10,
          },
          labelBgStyle: { fill: "#fbfbfd", fillOpacity: 0.96 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 3,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: 14,
            height: 14,
          },
        };
        return { edge: rfEdge, key: e.label, onPath, isCulprit };
      });

    // Path / culprit edges always keep their label; non-path edges dedupe
    // against a single occurrence per transition name so we never stack
    // two identical labels in the same place.
    const labelsShown = new Set<string>();
    for (const p of pending) {
      if (p.onPath || p.isCulprit) labelsShown.add(p.key);
    }
    const rfEdges: Edge[] = pending.map((p) => {
      if (p.onPath || p.isCulprit) return p.edge;
      if (labelsShown.has(p.key)) return { ...p.edge, label: "" };
      labelsShown.add(p.key);
      return p.edge;
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
          {hasCounterexample ? "with checker’s path" : "controller modes"}
        </span>
      </div>

      <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-ink-600">
        Each node is one of the controller&apos;s seven modes. Execution starts
        at <code className="font-mono text-ink-800">Idle</code>. Edges are
        transitions: some are operator commands or environment events
        (<code className="font-mono text-ink-800">arm</code>,{" "}
        <code className="font-mono text-ink-800">start_mission</code>,{" "}
        <code className="font-mono text-ink-800">authorized_actuation</code>);
        others are reactive and fire automatically when their guard is
        satisfied (<code className="font-mono text-ink-800">comms_degrade</code>,{" "}
        <code className="font-mono text-ink-800">low_battery_recovery</code>).
        {hasCounterexample && (
          <>
            {" "}After the check finds an unsafe execution, the path the
            checker walked is drawn in blue with numbered steps and the
            failing transition is shown in red. Faded edges are not part of
            this counterexample.
          </>
        )}
      </p>

      <div className="mt-4 h-[360px] rounded border border-line bg-paper">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.5}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll={false}
          zoomOnPinch
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#eef0f4" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
