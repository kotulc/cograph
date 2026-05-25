/** Cytoscape graph canvas — mounts and manages the cy instance imperatively. */

import React, { useRef, useEffect } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { GraphModel } from '@cograph/core';
import { useGraphModel } from './useGraphModel.js';

cytoscape.use(fcose as cytoscape.Ext);


// ── Stylesheet ────────────────────────────────────────────────────────────────

const STYLESHEET: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': '9px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 3,
      color: '#333',                // dark label text on white canvas
      'text-wrap': 'ellipsis',
      'text-max-width': '60px',
      'min-zoomed-font-size': 6,
    },
  },
  {
    // Structural compound: filesystem folder at the current depth
    selector: 'node[kind="folder"]',
    style: {
      shape: 'round-rectangle',
      'background-color': '#e3f2fd',
      'border-color': '#64b5f6',
      'border-width': 2,
      'background-opacity': 0.3,
      'font-weight': 'bold',
      'font-size': '11px',
      color: '#1565c0',
      'text-valign': 'top',
      'text-margin-y': -6,
      'text-max-width': '160px',  // wider for relative paths
      'text-wrap': 'ellipsis',
      padding: '24px',            // more inner space so nodes don't touch borders
    },
  },
  {
    // Semantic sub-cluster compound: HAC grouping within a folder
    selector: 'node[kind="subcluster"]',
    style: {
      shape: 'round-rectangle',
      'background-color': '#fff8e1',
      'border-color': '#ffd54f',
      'border-width': 1,
      'background-opacity': 0.5,
      'font-size': '9px',
      'font-style': 'italic',
      color: '#5d4037',
      'text-valign': 'top',
      'text-margin-y': -4,
      padding: '10px',
    },
  },
  {
    selector: 'node[kind="file"]',
    style: {
      shape: 'ellipse',
      'background-color': 'data(color)',
      'border-color': '#777',
      'border-width': 1,
      width: 10,
      height: 10,
      color: '#333',
      'text-valign': 'bottom',
      'font-size': '7px',
      'min-zoomed-font-size': 1.5,  // hide label until zoom ≥ 1.5× — reduces clutter
    },
  },
  {
    // Binary / asset files: diamond shape to distinguish from text files
    selector: 'node[kind="file"][language="image"], node[kind="file"][language="pdf"], node[kind="file"][language="video"], node[kind="file"][language="audio"], node[kind="file"][language="font"], node[kind="file"][language="archive"]',
    style: {
      shape: 'diamond',
      width: 9,
      height: 9,
      'background-opacity': 0.7,
      'border-style': 'dashed',
    },
  },
  {
    // Similar edges: sub-cluster ↔ sub-cluster (or folder ↔ folder) sharing a concept
    selector: 'edge[kind="similar"]',
    style: {
      'line-style': 'solid',
      'line-color': '#90caf9',
      width: 2,
      opacity: 0.6,
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
  animationDuration: 450,
  randomize: true,
  nodeSeparation: 30,       // tighter within a compound (files are small)
  idealEdgeLength: 180,     // push cross-folder similar-edge endpoints apart
  nodeRepulsion: 6500,      // per-node; compounds will be farther apart
  gravity: 0.15,
  gravityRange: 1.2,
  padding: 50,
  nestingFactor: 0.1,       // compound padding factor (smaller = more space inside)
  tile: true,
  tilingPaddingVertical: 20,
  tilingPaddingHorizontal: 20,
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
      maxZoom: 5,
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

  // Click handler: walk up the Cytoscape compound hierarchy to find the nearest folder.
  // This means clicking a file or sub-cluster also navigates to its containing folder.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !onNodeClick) return;

    const handler = (e: cytoscape.EventObject) => {
      const node = e.target as cytoscape.NodeSingular;
      const kind = node.data('kind') as string;

      if (kind === 'folder') {
        onNodeClick(node.id(), 'folder');
        return;
      }

      // Walk up the compound parent chain to find the enclosing folder
      let parent = node.parent();
      while (parent.nonempty()) {
        if (parent.data('kind') === 'folder') {
          onNodeClick(parent.id(), 'folder');
          return;
        }
        parent = parent.parent();
      }

      // Fallback: fire as-is (e.g., orphaned nodes in root-files compound)
      onNodeClick(node.id(), kind);
    };

    cy.on('tap', 'node', handler);
    return () => { cy.off('tap', 'node', handler); };
  }, [onNodeClick]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  );
}
