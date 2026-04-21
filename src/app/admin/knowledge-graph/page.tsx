'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'book' | 'author' | 'printer' | 'place' | 'subject';
  size?: number;
  year?: number;
  metadata?: Record<string, unknown>;
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: 'authored' | 'printed_by' | 'printed_in' | 'has_subject' | 'same_work' | 'shared_entities';
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    books: number;
    authors: number;
    places: number;
    printers: number;
    subjects: number;
    workGroups: number;
  };
}

const TYPE_COLORS: Record<string, string> = {
  book: '#8B7355',
  author: '#C45B28',
  printer: '#2E7D5B',
  place: '#4A6FA5',
  subject: '#7B4F8A',
};

const TYPE_LABELS: Record<string, string> = {
  book: 'Books',
  author: 'Authors',
  printer: 'Printers',
  place: 'Places',
  subject: 'Subjects',
};

export default function KnowledgeGraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [filters, setFilters] = useState({
    showBooks: true,
    showAuthors: true,
    showPrinters: true,
    showPlaces: true,
    showSubjects: true,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  useEffect(() => {
    fetch('/api/admin/knowledge-graph')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);

  const getVisibleTypes = useCallback(() => {
    const types: string[] = [];
    if (filters.showBooks) types.push('book');
    if (filters.showAuthors) types.push('author');
    if (filters.showPrinters) types.push('printer');
    if (filters.showPlaces) types.push('place');
    if (filters.showSubjects) types.push('subject');
    return types;
  }, [filters]);

  useEffect(() => {
    if (!data || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const visibleTypes = getVisibleTypes();

    // Filter nodes and edges
    const visibleNodes = data.nodes.filter(n => visibleTypes.includes(n.type));
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = data.edges.filter(e => {
      const srcId = typeof e.source === 'string' ? e.source : e.source.id;
      const tgtId = typeof e.target === 'string' ? e.target : e.target.id;
      return visibleNodeIds.has(srcId) && visibleNodeIds.has(tgtId);
    });

    // Search highlight
    const searchLower = searchTerm.toLowerCase();
    const matchedIds = searchTerm
      ? new Set(visibleNodes.filter(n => n.label.toLowerCase().includes(searchLower)).map(n => n.id))
      : null;

    const g = svg.append('g');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Simulation
    const simulation = d3.forceSimulation<GraphNode>(visibleNodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(visibleEdges)
        .id(d => d.id)
        .distance(d => {
          const t = typeof d.type === 'string' ? d.type : 'authored';
          return t === 'authored' ? 80 : t === 'printed_in' ? 120 : 100;
        })
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(-150).distanceMax(400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => (d.size || 5) + 3));

    simulationRef.current = simulation;

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(visibleEdges)
      .join('line')
      .attr('stroke', '#444')
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 0.5);

    // Nodes
    const node = g.append('g')
      .selectAll<SVGCircleElement, GraphNode>('circle')
      .data(visibleNodes)
      .join('circle')
      .attr('r', d => d.size || 5)
      .attr('fill', d => TYPE_COLORS[d.type] || '#666')
      .attr('stroke', d => matchedIds?.has(d.id) ? '#FFD700' : 'none')
      .attr('stroke-width', d => matchedIds?.has(d.id) ? 3 : 0)
      .attr('opacity', d => matchedIds && !matchedIds.has(d.id) ? 0.2 : 0.85)
      .style('cursor', 'pointer')
      .on('click', (_, d) => setSelected(d))
      .on('mouseover', function (event, d) {
        d3.select(this).attr('r', (d.size || 5) * 1.5);
        // Highlight connected edges
        link.attr('stroke-opacity', e => {
          const s = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
          const t = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
          return s === d.id || t === d.id ? 0.8 : 0.1;
        }).attr('stroke-width', e => {
          const s = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
          const t = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
          return s === d.id || t === d.id ? 2 : 0.5;
        });
      })
      .on('mouseout', function (_, d) {
        d3.select(this).attr('r', d.size || 5);
        link.attr('stroke-opacity', 0.3).attr('stroke-width', 0.5);
      });

    // Labels (only for larger nodes)
    const labels = g.append('g')
      .selectAll<SVGTextElement, GraphNode>('text')
      .data(visibleNodes.filter(n => (n.size || 0) >= 8 || n.type !== 'book'))
      .join('text')
      .text(d => d.label.substring(0, 25))
      .attr('font-size', d => d.type === 'book' ? '8px' : '10px')
      .attr('fill', '#ddd')
      .attr('text-anchor', 'middle')
      .attr('dy', d => (d.size || 5) + 12)
      .style('pointer-events', 'none');

    // Drag
    const drag = d3.drag<SVGCircleElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!);
      node
        .attr('cx', d => d.x!)
        .attr('cy', d => d.y!);
      labels
        .attr('x', d => d.x!)
        .attr('y', d => d.y!);
    });

    return () => { simulation.stop(); };
  }, [data, filters, searchTerm, getVisibleTypes]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#ccc', background: '#1a1a1a' }}>
        Loading ISTC knowledge graph...
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1a1a1a', color: '#eee' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>ISTC Knowledge Graph</h1>

        {/* Search */}
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #444', background: '#2a2a2a', color: '#eee', width: '200px' }}
        />

        {/* Filters */}
        <div style={{ display: 'flex', gap: '12px', fontSize: '13px' }}>
          {Object.entries(TYPE_LABELS).map(([type, label]) => (
            <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filters[`show${label}` as keyof typeof filters]}
                onChange={() => setFilters(f => ({ ...f, [`show${label}`]: !f[`show${label}` as keyof typeof filters] }))}
              />
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: TYPE_COLORS[type], display: 'inline-block' }} />
              {label}
            </label>
          ))}
        </div>

        {/* Stats */}
        {data && (
          <div style={{ fontSize: '12px', color: '#888', marginLeft: 'auto' }}>
            {data.stats.books} books | {data.stats.authors} authors | {data.stats.places} places | {data.stats.printers} printers
          </div>
        )}
      </div>

      {/* Graph */}
      <div style={{ flex: 1, position: 'relative' }}>
        <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />

        {/* Selected node panel */}
        {selected && (
          <div style={{
            position: 'absolute', top: '20px', right: '20px',
            background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px',
            padding: '16px', maxWidth: '320px', fontSize: '13px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                background: TYPE_COLORS[selected.type], color: '#fff',
              }}>
                {selected.type}
              </span>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px' }}>
                x
              </button>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '15px' }}>{selected.label}</h3>
            {selected.year && <p style={{ margin: '4px 0', color: '#aaa' }}>Year: {selected.year}</p>}
            {selected.metadata && (
              <div style={{ marginTop: '8px' }}>
                {Object.entries(selected.metadata).map(([key, val]) => (
                  val ? <p key={key} style={{ margin: '2px 0', color: '#999' }}><strong>{key}:</strong> {String(val)}</p> : null
                ))}
              </div>
            )}
            {selected.type === 'book' && !!selected.metadata?.slug && (
              <a
                href={`/book/${String(selected.metadata.slug)}`}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block', marginTop: '8px', color: '#6BA3D6', textDecoration: 'none' }}
              >
                View book →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
