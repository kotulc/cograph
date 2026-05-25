/** Cytoscape graph canvas — mounts and manages the cy instance imperatively. */

import React, { useRef, useEffect, useCallback } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { GraphModel } from '@cograph/core';
import { useGraphModel, CyElement } from './useGraphModel.js';

cytoscape.use(fcose as cytoscape.Ext);


// ── Stylesheet ────────────────────────────────────────────────────────────────

const STYLESHEET: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': '10px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 4,
      color: '#333',
      'text-wrap': 'ellipsis',
      'text-max-width': '80px',
    },
  },
  {
    // Structural compound: filesystem folder
    selector: 'node[kind="folder"]',
    style: {
      shape: 'round-rectangle',
      'background-color': '#e3f2fd',
      'border-color': '#90caf9',
      'border-width': 2,
      'background-opacity': 0.35,
      'font-weight': 'bold',
      'font-size': '13px',
      'text-valign': 'top',
      padding: '20px',
    },
  },
  {
    // Semantic sub-cluster compound: HAC grouping within a folder
    selector: 'node[kind="subcluster"]',
    style: {
      shape: 'round-rectangle',
      'background-color': '#fff8e1',
      'border-color': '#ffca28',
      'border-width': 1,
      'background-opacity': 0.5,
      'font-size': '10px',
      'font-style': 'italic',
      'text-valign': 'top',
      padding: '12px',
    },
  },
  {
    selector: 'node[kind="file"]',
    style: {
      shape: 'ellipse',
      'background-color': 'data(color)',
      'border-color': '#555',
      'border-width': 1,
      width: 32,
      height: 32,
      color: '#fff',
      'font-size': '9px',
    },
  },
  {
    // Similar edges: connect sub-cluster compounds that share a global concept
    selector: 'edge[kind="similar"]',
    style: {
      'line-style': 'solid',
      'line-color': '#90caf9',
      width: 2,
      opacity: 0.55,
      'target-arrow-shape': 'none',
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge[kind="reference"]',
    style: {
      'line-style': 'dashed',
      'line-color': '#a5d6a7',
      width: 1.5,
      opacity: 0.7,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#a5d6a7',
      'curve-style': 'bezier',
    },
  },
  {
    // Contains edges are structural (redundant with compound nesting) — hidden
    selector: 'edge[kind="contains"]',
    style: { display: 'none' },
  },
  {
    selector: 'node:selected',
    style: { 'border-color': '#1565c0', 'border-width': 3 },
  },
];

const LAYOUT_OPTS: cytoscape.LayoutOptions = {
  name: 'fcose',
  quality: 'default',
  animate: true,
  animationDuration: 500,
  nodeSeparation: 80,
  idealEdgeLength: 100,
  nodeRepulsion: 8000,
  gravity: 0.25,
  padding: 40,
  nestingFactor: 0.1,
} as cytoscape.LayoutOptions;


// ── Props ─────────────────────────────────────────────────────────────────────

export interface CographCanvasProps {
  model: GraphModel | null;
  rootId: string;
  depth: number;
  onNodeClick?: (id: string, kind: string) => void;
}


// ── Component ─────────────────────────────────────────────────────────────────

export function CographCanvas({ model, rootId, depth, onNodeClick }: CographCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const { elements } = useGraphModel(model, rootId, depth);

  // Mount Cytoscape once
  useEffect(() => {
    if (!containerRef.current) return;
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [],
      style: STYLESHEET,
      minZoom: 0.05,
      maxZoom: 4,
    });
    return () => { cyRef.current?.destroy(); cyRef.current = null; };
  }, []);

  // Sync elements + re-layout whenever they change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements as cytoscape.ElementDefinition[]);
    });
    cy.layout(LAYOUT_OPTS).run();
  }, [elements]);

  // Wire click handler
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !onNodeClick) return;
    const handler = (e: cytoscape.EventObject) => {
      const node = e.target as cytoscape.NodeSingular;
      onNodeClick(node.id(), node.data('kind') as string);
    };
    cy.on('tap', 'node', handler);
    return () => { cy.off('tap', 'node', handler); };
  }, [onNodeClick]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  );
}
