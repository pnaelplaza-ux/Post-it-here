import React, { useState, useRef, useCallback, useEffect } from 'react';
import InfiniteCanvas from './components/InfiniteCanvas';
import Controls from './components/Controls';
import { Viewport, Point, NoteColor, NoteData, StampData, CHUNK_SIZE, CursorData, ToolMode } from './types';
import { db, auth, isDemoMode } from './firebaseConfig';
import { ref, push, set, serverTimestamp, onChildChanged, onChildAdded, remove, onValue } from 'firebase/database';

// Constants
const INITIAL_SCALE = 1;
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const FRICTION = 0.95;
const STOP_THRESHOLD = 0.01;
const KEY_PAN_SPEED = 15;

// Bot definition for Demo Mode
interface Bot {
    id: string;
    x: number;
    y: number;
    color: string;
    targetX: number;
    targetY: number;
}

const App: React.FC = () => {
  // --- STATE ---
  const [viewport, setViewport] = useState<Viewport>({ x: window.innerWidth/2, y: window.innerHeight/2, scale: INITIAL_SCALE });
  
  // Tools & Modals
  const [tool, setTool] = useState<ToolMode>('pan');
  const [selectedEmoji, setSelectedEmoji] = useState<string>('❤️');
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Note Creation
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteColor, setNewNoteColor] = useState<NoteColor>(NoteColor.Yellow);
  const [creationPos, setCreationPos] = useState<Point | null>(null);
  const [lastPostTime, setLastPostTime] = useState(0);

  // Multiplayer State
  const [cursors, setCursors] = useState<CursorData[]>([]);
  const botsRef = useRef<Bot[]>([]);

  // Physics Refs
  const velocity = useRef<Point>({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const lastMousePos = useRef<Point>({ x: 0, y: 0 });
  
  // Keyboard State
  const keysPressed = useRef<Set<string>>(new Set());
  const keyLoopRef = useRef<number | null>(null);

  // --- MOVEMENT & INPUT LOGIC ---

  // Keyboard Panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        keysPressed.current.add(e.code);
        startKeyLoop();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (keysPressed.current.has(e.code)) {
        keysPressed.current.delete(e.code);
        if (keysPressed.current.size === 0) stopKeyLoop();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      stopKeyLoop();
    };
  }, [isModalOpen]);

  const startKeyLoop = () => {
    if (keyLoopRef.current) return;
    const loop = () => {
      let dx = 0;
      let dy = 0;
      const keys = keysPressed.current;
      if (keys.has('ArrowUp') || keys.has('KeyW')) dy += KEY_PAN_SPEED;
      if (keys.has('ArrowDown') || keys.has('KeyS')) dy -= KEY_PAN_SPEED;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) dx += KEY_PAN_SPEED;
      if (keys.has('ArrowRight') || keys.has('KeyD')) dx -= KEY_PAN_SPEED;

      if (dx !== 0 || dy !== 0) {
        stopInertia();
        setViewport(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      }
      if (keys.size > 0) keyLoopRef.current = requestAnimationFrame(loop);
      else stopKeyLoop();
    };
    keyLoopRef.current = requestAnimationFrame(loop);
  };

  const stopKeyLoop = () => {
    if (keyLoopRef.current) {
      cancelAnimationFrame(keyLoopRef.current);
      keyLoopRef.current = null;
    }
  };

  // Inertia
  const startInertia = useCallback(() => {
    if (Math.abs(velocity.current.x) < STOP_THRESHOLD && Math.abs(velocity.current.y) < STOP_THRESHOLD) return;
    const loop = () => {
      if (isDraggingRef.current) return;
      velocity.current.x *= FRICTION;
      velocity.current.y *= FRICTION;
      if (Math.abs(velocity.current.x) < STOP_THRESHOLD && Math.abs(velocity.current.y) < STOP_THRESHOLD) {
        velocity.current = { x: 0, y: 0 };
        return;
      }
      setViewport(prev => ({ ...prev, x: prev.x + velocity.current.x, y: prev.y + velocity.current.y }));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopInertia = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Mouse/Touch Handling
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (tool === 'stamp') return; // Don't drag in stamp mode (unless we add specific drag logic)
    if ('touches' in e && e.touches.length > 1) return;

    stopInertia();
    velocity.current = { x: 0, y: 0 };
    isDraggingRef.current = true;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    lastMousePos.current = { x: clientX, y: clientY };

    const handleMove = (ev: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      const cx = 'touches' in ev ? (ev as TouchEvent).touches[0].clientX : (ev as MouseEvent).clientX;
      const cy = 'touches' in ev ? (ev as TouchEvent).touches[0].clientY : (ev as MouseEvent).clientY;
      
      const dx = cx - lastMousePos.current.x;
      const dy = cy - lastMousePos.current.y;
      
      lastMousePos.current = { x: cx, y: cy };
      velocity.current = { x: dx, y: dy };
      
      setViewport(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };

    const handleUp = () => {
      isDraggingRef.current = false;
      startInertia();
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
  }, [stopInertia, startInertia, tool]);

  // Zoom
  const screenToWorld = useCallback((sx: number, sy: number) => {
    return {
      x: (sx - viewport.x) / viewport.scale,
      y: (sy - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopInertia();
      const zoomIntensity = 0.001;
      const newScale = Math.min(Math.max(viewport.scale + e.deltaY * -zoomIntensity, MIN_SCALE), MAX_SCALE);
      const worldMouseBefore = screenToWorld(e.clientX, e.clientY);
      const newViewportX = e.clientX - worldMouseBefore.x * newScale;
      const newViewportY = e.clientY - worldMouseBefore.y * newScale;
      setViewport({ x: newViewportX, y: newViewportY, scale: newScale });
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [viewport, screenToWorld, stopInertia]);


  // --- GAMEPLAY LOGIC ---

  const handleCanvasClick = (point: Point) => {
      if (tool === 'stamp') {
          createStamp(point);
      }
  };

  const handleDoubleClick = (point: Point) => {
      if (tool === 'pan') {
          setCreationPos(point);
          setIsModalOpen(true);
      }
  };

  const createStamp = async (point: Point) => {
    const chunkX = Math.floor(point.x / CHUNK_SIZE);
    const chunkY = Math.floor(point.y / CHUNK_SIZE);
    const chunkKey = `${chunkX}_${chunkY}`;

    const newStamp: StampData = {
        id: `stamp-${Date.now()}-${Math.random()}`,
        x: point.x,
        y: point.y,
        emoji: selectedEmoji,
        rotation: (Math.random() * 30) - 15,
        timestamp: Date.now()
    };

    if (isDemoMode || !db) {
        const json = localStorage.getItem(`chunk_stamps_${chunkKey}`);
        const data = json ? JSON.parse(json) : {};
        data[newStamp.id] = newStamp;
        localStorage.setItem(`chunk_stamps_${chunkKey}`, JSON.stringify(data));
        window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { chunkKey, type: 'stamp' } }));
    } else {
        const stampRef = push(ref(db, `stamps/${chunkKey}`));
        await set(stampRef, newStamp);
    }
  };

  const handleCreateNote = async () => {
    if (!newNoteText.trim() || newNoteText.length > 200) return;
    
    const now = Date.now();
    if (now - lastPostTime < 1000) return; // Rate limit

    const pos = creationPos || screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    // Slight jitter if center
    const x = pos.x + (creationPos ? 0 : (Math.random() - 0.5) * 40);
    const y = pos.y + (creationPos ? 0 : (Math.random() - 0.5) * 40);

    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkY = Math.floor(y / CHUNK_SIZE);
    const chunkKey = `${chunkX}_${chunkY}`;

    if (isDemoMode || !db) {
        const id = `local-${Date.now()}`;
        const newNote: NoteData = {
            id,
            x,
            y,
            text: newNoteText,
            color: newNoteColor,
            rotation: (Math.random() * 6) - 3,
            timestamp: now,
            authorId: 'anon-local'
        };
        const existingJson = localStorage.getItem(`chunk_${chunkKey}`);
        const existingData = existingJson ? JSON.parse(existingJson) : {};
        existingData[id] = newNote;
        localStorage.setItem(`chunk_${chunkKey}`, JSON.stringify(existingData));
        window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { chunkKey, type: 'note' } }));
    } else {
        const newNoteRef = push(ref(db, `chunks/${chunkKey}`));
        await set(newNoteRef, {
            id: newNoteRef.key,
            x,
            y,
            text: newNoteText,
            color: newNoteColor,
            rotation: (Math.random() * 6) - 3,
            timestamp: serverTimestamp(),
            authorId: auth?.currentUser?.uid || 'anon'
        });
    }

    setLastPostTime(now);
    setNewNoteText("");
    setIsModalOpen(false);
    setCreationPos(null);
    setTool('pan'); // Reset to pan after posting
  };

  // --- MULTIPLAYER & BOTS ---

  // Bot Logic (Demo Mode)
  useEffect(() => {
    if (!isDemoMode) return;

    // Create 5 bots
    const colors = ['#f87171', '#60a5fa', '#4ade80', '#fbbf24', '#a78bfa'];
    botsRef.current = Array.from({ length: 5 }).map((_, i) => ({
        id: `bot-${i}`,
        x: (Math.random() - 0.5) * 1000,
        y: (Math.random() - 0.5) * 1000,
        color: colors[i % colors.length],
        targetX: (Math.random() - 0.5) * 2000,
        targetY: (Math.random() - 0.5) * 2000
    }));

    const interval = setInterval(() => {
        // Update bot positions
        botsRef.current = botsRef.current.map(bot => {
            const dx = bot.targetX - bot.x;
            const dy = bot.targetY - bot.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 10) {
                // Pick new target
                return {
                    ...bot,
                    targetX: (Math.random() - 0.5) * 2000, // Stay somewhat local
                    targetY: (Math.random() - 0.5) * 2000
                };
            }

            const speed = 5;
            return {
                ...bot,
                x: bot.x + (dx / dist) * speed,
                y: bot.y + (dy / dist) * speed
            };
        });

        // Convert to cursor data for rendering
        const cursorData: CursorData[] = botsRef.current.map(bot => ({
            id: bot.id,
            x: bot.x,
            y: bot.y,
            color: bot.color,
            lastUpdate: Date.now()
        }));

        // Occasionally drop a stamp
        if (Math.random() < 0.02) {
            const bot = botsRef.current[Math.floor(Math.random() * botsRef.current.length)];
            const stampPoint = { x: bot.x, y: bot.y };
            // Hacky: dispatch storage event for the stamp
            const chunkX = Math.floor(bot.x / CHUNK_SIZE);
            const chunkY = Math.floor(bot.y / CHUNK_SIZE);
            const chunkKey = `${chunkX}_${chunkY}`;
            const emojis = ['❤️', '🔥', '👀', '🚀'];
            
            const newStamp: StampData = {
                id: `bot-stamp-${Date.now()}`,
                x: bot.x,
                y: bot.y,
                emoji: emojis[Math.floor(Math.random() * emojis.length)],
                rotation: (Math.random() * 30) - 15,
                timestamp: Date.now()
            };
            
            const json = localStorage.getItem(`chunk_stamps_${chunkKey}`);
            const data = json ? JSON.parse(json) : {};
            data[newStamp.id] = newStamp;
            localStorage.setItem(`chunk_stamps_${chunkKey}`, JSON.stringify(data));
            window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { chunkKey, type: 'stamp' } }));
        }

        setCursors(cursorData);
    }, 50);

    return () => clearInterval(interval);
  }, []);

  // Real Multiplayer Logic (Firebase)
  useEffect(() => {
    if (isDemoMode || !db) return;
    
    // Subscribe to cursors
    // Note: In a real massive app, we wouldn't listen to ALL cursors, only those in view.
    // For this size, getting all active cursors is fine.
    const cursorsRef = ref(db, 'cursors');
    
    const unsub = onValue(cursorsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            setCursors([]);
            return;
        }
        const now = Date.now();
        const active: CursorData[] = [];
        Object.values(data).forEach((c: any) => {
            if (now - c.lastUpdate < 30000) { // Cleanup old cursors > 30s
                active.push(c);
            }
        });
        setCursors(active);
    });
    
    return () => unsub();
  }, []);

  // Publish own cursor (Firebase)
  useEffect(() => {
      if (isDemoMode || !db || !auth?.currentUser) return;
      
      const publishCursor = (e: MouseEvent) => {
          const worldPos = screenToWorld(e.clientX, e.clientY);
          // Throttle updates
          if (Math.random() > 0.1) return; 

          const myCursorRef = ref(db, `cursors/${auth.currentUser?.uid}`);
          set(myCursorRef, {
              id: auth.currentUser?.uid,
              x: worldPos.x,
              y: worldPos.y,
              color: '#3b82f6', // User color (could be random)
              lastUpdate: serverTimestamp()
          });
      };

      window.addEventListener('mousemove', publishCursor);
      return () => window.removeEventListener('mousemove', publishCursor);
  }, [screenToWorld]);


  // --- RENDER ---

  return (
    <div className="w-full h-screen overflow-hidden bg-[#f3f3f3] relative font-sans text-slate-800">
      
      <InfiniteCanvas 
        viewport={viewport}
        onViewportChange={setViewport}
        onCanvasDragStart={handleDragStart}
        onCanvasClick={handleCanvasClick}
        onCanvasDoubleClick={handleDoubleClick}
        shouldPan={tool === 'pan'}
        cursors={cursors}
      />

      {/* Header */}
      <div className="fixed top-0 left-0 right-0 p-6 pointer-events-none z-40">
        <h1 className="text-2xl font-bold tracking-tight text-gray-400 opacity-50 uppercase text-center md:text-left drop-shadow-sm">
          Post It Here <span className="text-xs font-normal normal-case block md:inline md:ml-2">
            {isDemoMode ? "Offline Demo (Bots Enabled)" : "Live Infinite Board"}
          </span>
        </h1>
      </div>

      <Controls 
        scale={viewport.scale}
        tool={tool}
        setTool={setTool}
        selectedEmoji={selectedEmoji}
        setSelectedEmoji={setSelectedEmoji}
        onZoomIn={() => setViewport(prev => ({ ...prev, scale: Math.min(prev.scale * 1.2, MAX_SCALE) }))}
        onZoomOut={() => setViewport(prev => ({ ...prev, scale: Math.max(prev.scale / 1.2, MIN_SCALE) }))}
        onResetView={() => {
            stopInertia();
            setViewport({ x: window.innerWidth/2, y: window.innerHeight/2, scale: 1 });
        }}
        onAddNote={() => {
            setCreationPos(null);
            setIsModalOpen(true);
        }}
      />

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 opacity-100">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">
                    {creationPos ? "Place Note Here" : "New Sticky Note"}
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              <div className="relative mb-6">
                <textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  maxLength={200}
                  placeholder="Write something (max 200 chars)..."
                  className="w-full h-32 p-4 text-xl font-handwriting bg-gray-50 rounded-xl border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all resize-none outline-none text-gray-700"
                  autoFocus
                />
                <div className="text-right text-xs text-gray-400 mt-1">{newNoteText.length}/200</div>
              </div>

              <div className="flex gap-3 mb-8 justify-center">
                {Object.values(NoteColor).map(color => (
                  <button
                    key={color}
                    onClick={() => setNewNoteColor(color)}
                    style={{ backgroundColor: color }}
                    className={`w-10 h-10 rounded-full shadow-sm hover:scale-110 ring-2 ring-offset-2 ${newNoteColor === color ? 'ring-gray-400 scale-110' : 'ring-transparent'}`}
                  />
                ))}
              </div>

              <button
                onClick={handleCreateNote}
                disabled={!newNoteText.trim()}
                className="w-full bg-black text-white py-3.5 rounded-xl font-medium shadow-lg hover:shadow-xl hover:bg-gray-900 transition-all disabled:opacity-50"
              >
                Post It
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="fixed bottom-6 right-6 pointer-events-none text-gray-400 text-sm hidden md:block select-none">
        <p>Double-click to post &bull; WASD to move &bull; Scroll to zoom</p>
      </div>
    </div>
  );
};

export default App;