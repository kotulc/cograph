/** Cytoscape graph canvas — mounts and manages the cy instance imperatively. */

import React, { useRef, useEffect } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { GraphModel } from '@cograph/core';
import { useGraphModel } from './useGraphModel.js';
import type { Metric } from './ColorMap.js';
import type { Filters } from './FilterPanel.js';

cytoscape.use(fcose as cytoscape.Ext);


// ── Stylesheet ────────────────────────────────────────────────────────────────
// Uses :parent / :childless selectors so each kind has a compound style and a dot style.

const STYLESHEET: cytoscape.StylesheetStyle[] = [
  // ── Base dot (all childless nodes) ──
  {
    selector: 'node:childless',
    style: {
      width: 10, height: 10,
      'background-color': 'data(color)',
      'border-width': 0,
      label: 'data(label)',
      'font-size': '8px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 3,
      'text-max-width': '60px',
      'text-wrap': 'ellipsis',
      color: '#555',
      'min-zoomed-font-size': 0,
    },
  },

  // ── Folder compound ──
  {
    selector: 'node[kind="folder"]:parent',
    style: {
      shape: 'round-rectangle',
      'background-color': '#e3f2fd',
      'border-color': '#64b5f6',
      'border-width': 2,
      'background-opacity': 0.35,
      label: 'data(label)',
      'font-size': '11px',
      'font-weight': 'bold',
      color: '#1565c0',
      'text-valign': 'top',
      'text-margin-y': -6,
      'text-max-width': '160px',
      'text-wrap': 'ellipsis',
      padding: '20px',
    },
  },
  // Folder dot — shown inside a parent compound
  {
    selector: 'node[kind="folder"]:childless',
    style: {
      shape: 'round-rectangle',
      'background-color': '#90a4ae',
      width: 14, height: 10,
      label: 'data(label)',
      'font-size': '7px',
    },
  },

  // ── File compound (expanded — shows blocks inside) ──
  {
    selector: 'node[kind="file"]:parent',
    style: {
      shape: 'round-rectangle',
      'background-color': 'data(color)',
      'background-opacity': 0.15,
      'border-color': 'data(color)',
      'border-width': 1.5,
      label: 'data(label)',
      'font-size': '10px',
      'font-weight': 'bold',
      color: '#333',
      'text-valign': 'top',
      'text-margin-y': -4,
      'text-max-width': '140px',
      'text-wrap': 'ellipsis',
      padding: '16px',
    },
  },
  // File dot — shown inside folder compound or as leaf (binary)
  {
    selector: 'node[kind="file"]:childless',
    style: {
      shape: 'ellipse',
      'background-color': 'data(color)',
      'background-opacity': 0.85,
      width: 10, height: 10,
      label: 'data(label)',
      'font-size': '7px',
      // @ts-expect-error cytoscape types omit cursor but runtime supports it
      cursor: 'pointer',
    },
  },

  // ── Block compound (expanded — shows elements inside) ──
  {
    selector: 'node[kind="block"]:parent',
    style: {
      shape: 'round-rectangle',
      'background-color': 'data(color)',
      'background-opacity': 0.12,
      'border-color': 'data(color)',
      'border-width': 1,
      'border-opacity': 0.5,
      label: 'data(label)',
      'font-size': '8px',
      'font-style': 'italic',
      color: '#555',
      'text-valign': 'top',
      'text-margin-y': -3,
      'text-max-width': '120px',
      'text-wrap': 'ellipsis',
      padding: '10px',
    },
  },
  // Block dot — shown inside file compound
  {
    selector: 'node[kind="block"]:childless',
    style: {
      shape: 'round-rectangle',
      'background-color': 'data(color)',
      'background-opacity': 0.7,
      width: 12, height: 8,
      label: 'data(label)',
      'font-size': '6px',
    },
  },

  // ── Element dot (always a leaf) ──
  {
    selector: 'node[kind="element"]',
    style: {
      shape: 'ellipse',
      'background-color': 'data(color)',
      'background-opacity': 0.85,
      'border-width': 0,
      width: 7, height: 7,
      label: 'data(label)',
      'font-size': '6px',
      'text-valign': 'bottom',
      'text-margin-y': 2,
      // @ts-expect-error cytoscape types omit cursor but runtime supports it
      cursor: 'pointer',
    },
  },

  // ── Hover states ──
  { selector: 'node:parent:hover', style: { 'border-width': 3 } },
  { selector: 'node:childless:hover', style: { 'border-width': 2, 'border-color': '#1565c0' } },

  // ── Selected ──
  { selector: 'node:selected', style: { 'border-color': '#1565c0', 'border-width': 3 } },

  // ── Edges ──
  {
    selector: 'edge[kind="similar"]',
    style: {
      'line-style': 'solid',
      'line-color': '#90caf9',
      width: 1.5,
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
  { selector: 'edge[kind="contains"]', style: { display: 'none' } },
];

const LAYOUT_OPTS: cytoscape.LayoutOptions = {
  name: 'fcose',
  quality: 'default',
  animate: true,
  animationDuration: 380,
  randomize: true,
  nodeSeparation: 12,
  idealEdgeLength: 80,
  nodeRepulsion: 4500,
  gravity: 0.25,
  gravityRange: 1.5,
  padding: 40,
  nestingFactor: 0.1,
  tile: true,
  tilingPaddingVertical: 12,
  tilingPaddingHorizontal: 12,
} as cytoscape.LayoutOptions;


// ── Props ─────────────────────────────────────────────────────────────────────

export interface CographCanvasProps {
  model: GraphModel | null;
  selectedId: string;
  metric?: Metric;
  filters?: Filters;
  onNavigateInto?: (id: string) => void;
  onElementClick?: (id: string, tokens: string[]) => void;
}


// ── Component ─────────────────────────────────────────────────────────────────

export function CographCanvas({
  model, selectedId, metric = 'language', filters,
  onNavigateInto, onElementClick,
}: CographCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const { elements } = useGraphModel(model, selectedId, metric);

  // Mount Cytoscape once
  useEffect(() => {
    if (!containerRef.current) return;
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [],
      style: STYLESHEET,
      minZoom: 0.05,
      maxZoom: 6,
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

  // Apply edge visibility from filters
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !filters) return;
    cy.edges('[kind="similar"]').style('display', filters.edges.has('similar') ? 'element' : 'none');
    cy.edges('[kind="reference"]').style('display', filters.edges.has('reference') ? 'element' : 'none');
  }, [filters, elements]);

  // Click handler: compound → navigate into; element → open token panel
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handler = (e: cytoscape.EventObject) => {
      const node = e.target as cytoscape.NodeSingular;
      const kind = node.data('kind') as string;

      // Element leaf → show token panel
      if (kind === 'element') {
        const tokens = (node.data('tokens') as string[] | undefined) ?? [];
        onElementClick?.(node.id(), tokens);
        return;
      }

      // Any compound or navigable dot → navigate into it
      if (kind === 'folder' || kind === 'file' || kind === 'block') {
        onNavigateInto?.(node.id());
      }
    };

    cy.on('tap', 'node', handler);
    return () => { cy.off('tap', 'node', handler); };
  }, [onNavigateInto, onElementClick]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  );
}
