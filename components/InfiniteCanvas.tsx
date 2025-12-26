import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { db, isDemoMode, auth } from '../firebaseConfig';
import { Viewport, NoteData, StampData, CursorData, CHUNK_SIZE, ChunkKey, Point } from '../types';
import { drawNote, drawStamp, drawCursor } from '../utils/canvasUtils';

interface InfiniteCanvasProps {
  viewport: Viewport;
  onViewportChange: (newViewport: Viewport) => void;
  onCanvasDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  onCanvasClick: (point: Point) => void;
  onCanvasDoubleClick: (point: Point) => void;
  newNotePreview?: NoteData | null;
  cursors: CursorData[]; // From App
}

const InfiniteCanvas: React.FC<InfiniteCanvasProps> = ({ 
  viewport, 
  onCanvasDragStart,
  onCanvasClick,
  onCanvasDoubleClick,
  newNotePreview,
  cursors
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Data State
  const chunksRef = useRef<Map<ChunkKey, NoteData[]>>(new Map());
  const stampChunksRef = useRef<Map<ChunkKey, StampData[]>>(new Map());
  const listenersRef = useRef<Set<ChunkKey>>(new Set());
  const lastRangeRef = useRef<string>("");
  const [forceRender, setForceRender] = useState(0); 

  // --- Chunk Management Logic ---

  // Optimized subscription manager that takes specific bounds
  const manageSubscriptions = useCallback((startCx: number, endCx: number, startCy: number, endCy: number) => {
    const neededChunks = new Set<ChunkKey>();
    
    for (let x = startCx; x <= endCx; x++) {
      for (let y = startCy; y <= endCy; y++) {
        neededChunks.add(`${x}_${y}`);
      }
    }

    // Subscribe to new chunks
    neededChunks.forEach(key => {
      if (!listenersRef.current.has(key)) {
        if (isDemoMode || !db) {
            // NOTES
            const jsonNotes = localStorage.getItem(`chunk_${key}`);
            const dataNotes = jsonNotes ? JSON.parse(jsonNotes) : {};
            chunksRef.current.set(key, Object.values(dataNotes) as NoteData[]);

            // STAMPS
            const jsonStamps = localStorage.getItem(`chunk_stamps_${key}`);
            const dataStamps = jsonStamps ? JSON.parse(jsonStamps) : {};
            stampChunksRef.current.set(key, Object.values(dataStamps) as StampData[]);

            setForceRender(n => n + 1);
            listenersRef.current.add(key);
        } else {
            // NOTES
            const chunkRef = ref(db, `chunks/${key}`);
            onValue(chunkRef, (snapshot) => {
                const data = snapshot.val();
                if (data) chunksRef.current.set(key, Object.values(data) as NoteData[]);
                else chunksRef.current.set(key, []);
                setForceRender(n => n + 1);
            });

            // STAMPS
            const stampRef = ref(db, `stamps/${key}`);
            onValue(stampRef, (snapshot) => {
                const data = snapshot.val();
                if (data) stampChunksRef.current.set(key, Object.values(data) as StampData[]);
                else stampChunksRef.current.set(key, []);
                setForceRender(n => n + 1);
            });

            listenersRef.current.add(key);
        }
      }
    });

    // Unsubscribe from old chunks and clean up memory
    listenersRef.current.forEach(key => {
      if (!neededChunks.has(key)) {
        if (!isDemoMode && db) {
             off(ref(db, `chunks/${key}`));
             off(ref(db, `stamps/${key}`));
        }
        listenersRef.current.delete(key);
        // Important: Release memory for off-screen chunks
        chunksRef.current.delete(key);
        stampChunksRef.current.delete(key);
      }
    });
  }, []);

  // Effect to calculate needed chunks based on viewport
  // Replaces the debounced approach with a "change detection" approach for smoother panning
  useEffect(() => {
    if (!containerRef.current) return;

    // Calculate visible area in world coordinates
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    
    const left = -viewport.x / viewport.scale;
    const top = -viewport.y / viewport.scale;
    const right = (width - viewport.x) / viewport.scale;
    const bottom = (height - viewport.y) / viewport.scale;

    // Load buffer: 1 chunk extra in each direction
    const buffer = CHUNK_SIZE; 
    
    const startCx = Math.floor((left - buffer) / CHUNK_SIZE);
    const endCx = Math.floor((right + buffer) / CHUNK_SIZE);
    const startCy = Math.floor((top - buffer) / CHUNK_SIZE);
    const endCy = Math.floor((bottom + buffer) / CHUNK_SIZE);

    const rangeKey = `${startCx}_${endCx}_${startCy}_${endCy}`;

    // Only update subscriptions if the grid of needed chunks has changed
    if (rangeKey !== lastRangeRef.current) {
        lastRangeRef.current = rangeKey;
        manageSubscriptions(startCx, endCx, startCy, endCy);
    }

  }, [viewport, manageSubscriptions]);


  // Listen for local storage updates (Demo Mode interaction)
  useEffect(() => {
    if (!isDemoMode) return;
    
    const handleLocalUpdate = (e: Event) => {
        const customEvent = e as CustomEvent;
        const key = customEvent.detail?.chunkKey;
        const type = customEvent.detail?.type; // 'note' or 'stamp'

        if (key && listenersRef.current.has(key)) {
            if (type === 'stamp') {
                const json = localStorage.getItem(`chunk_stamps_${key}`);
                const data = json ? JSON.parse(json) : {};
                stampChunksRef.current.set(key, Object.values(data));
            } else {
                const json = localStorage.getItem(`chunk_${key}`);
                const data = json ? JSON.parse(json) : {};
                chunksRef.current.set(key, Object.values(data));
            }
            setForceRender(n => n + 1);
        }
    };

    window.addEventListener('local-storage-update', handleLocalUpdate);
    return () => window.removeEventListener('local-storage-update', handleLocalUpdate);
  }, []);

  // --- Handling Interactions ---

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    onCanvasDragStart(e);
  };

  const handleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if(!rect) return;
    const x = (e.clientX - rect.left - viewport.x) / viewport.scale;
    const y = (e.clientY - rect.top - viewport.y) / viewport.scale;
    onCanvasClick({x, y});
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if(!rect) return;
    const x = (e.clientX - rect.left - viewport.x) / viewport.scale;
    const y = (e.clientY - rect.top - viewport.y) / viewport.scale;
    onCanvasDoubleClick({x, y});
  };

  // --- Rendering Logic ---

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Handle resizing
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context for camera transform
    ctx.save();
    
    // Apply Viewport Transform
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.scale, viewport.scale);

    const left = -viewport.x / viewport.scale;
    const top = -viewport.y / viewport.scale;
    const right = (canvas.width - viewport.x) / viewport.scale;
    const bottom = (canvas.height - viewport.y) / viewport.scale;

    // 1. Draw Dot Grid (Modern look)
    ctx.fillStyle = '#cbd5e1'; // gray-400
    const gridSize = 40;
    
    const startGridX = Math.floor(left / gridSize) * gridSize;
    const startGridY = Math.floor(top / gridSize) * gridSize;

    for (let x = startGridX; x < right; x += gridSize) {
        for (let y = startGridY; y < bottom; y += gridSize) {
            ctx.beginPath();
            ctx.arc(x, y, 1.5 / viewport.scale, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // --- Optimization: Spatially aware rendering loop ---
    // Only iterate chunks that are currently visible on screen + buffer
    const renderBuffer = 1; 
    const minCx = Math.floor(left / CHUNK_SIZE) - renderBuffer;
    const maxCx = Math.floor(right / CHUNK_SIZE) + renderBuffer;
    const minCy = Math.floor(top / CHUNK_SIZE) - renderBuffer;
    const maxCy = Math.floor(bottom / CHUNK_SIZE) + renderBuffer;

    // 2. Draw Stamps (Behind notes)
    for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
            const key = `${cx}_${cy}`;
            const stamps = stampChunksRef.current.get(key);
            if (stamps) {
                for (const stamp of stamps) {
                    drawStamp(ctx, stamp);
                }
            }
        }
    }

    // 3. Draw Notes
    for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
            const key = `${cx}_${cy}`;
            const notes = chunksRef.current.get(key);
            if (notes) {
                for (const note of notes) {
                    drawNote(ctx, note, false);
                }
            }
        }
    }
    
    // 4. Draw Preview Note
    if (newNotePreview) {
        ctx.globalAlpha = 0.8;
        drawNote(ctx, newNotePreview, true);
        ctx.globalAlpha = 1.0;
    }

    // 5. Draw Cursors
    cursors.forEach(cursor => {
        // Don't draw self (optional, if we were tracking self in array)
        if(cursor.id !== auth?.currentUser?.uid) {
            drawCursor(ctx, cursor);
        }
    });

    ctx.restore();

  }, [viewport, forceRender, newNotePreview, cursors]);

  return (
    <div 
      ref={containerRef} 
      className="absolute inset-0 overflow-hidden bg-[#f3f3f3] cursor-crosshair"
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

export default InfiniteCanvas;