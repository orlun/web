import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, ArrowRight, Plus, Minus } from 'lucide-react';
import { supabase } from '../lib/supabase';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface Character {
  id: string;
  name: string;
  src: string;
  bg: string;
  panel: string;
  points: number;
}

/* ------------------------------------------------------------------ */
/*  Static visual config (not stored in DB)                            */
/* ------------------------------------------------------------------ */
const CHARACTER_META: Record<string, Omit<Character, 'id' | 'name' | 'points'>> = {
  andres:    { src: '/avatars/andres.png',    bg: '#4A4A4A', panel: '#6B6B6B' },
  mario:     { src: '/avatars/mario.png',     bg: '#8B9467', panel: '#A2AB7D' },
  ivan:      { src: '/avatars/ivan.png',      bg: '#EADBB6', panel: '#F2E8D0' },
  alejandro: { src: '/avatars/alejandro.png', bg: '#88C9A1', panel: '#A3D6B7' },
  natalia:   { src: '/avatars/natalia.png',   bg: '#E882B4', panel: '#ED9DC4' },
};

const FALLBACK_CHARACTERS: Character[] = [
  { id: 'andres',    name: 'Andrés',    points: 12, ...CHARACTER_META.andres },
  { id: 'mario',     name: 'Mario',     points: 15, ...CHARACTER_META.mario },
  { id: 'ivan',      name: 'Iván',      points: 8,  ...CHARACTER_META.ivan },
  { id: 'alejandro', name: 'Alejandro', points: 5,  ...CHARACTER_META.alejandro },
  { id: 'natalia',   name: 'Natalia',   points: 10, ...CHARACTER_META.natalia },
];

const COUNT = 5;

/* ------------------------------------------------------------------ */
/*  Grain SVG data URI                                                 */
/* ------------------------------------------------------------------ */
const GRAIN_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)' opacity='0.08'/%3E%3C/svg%3E")`;

/* ------------------------------------------------------------------ */
/*  Transition easing                                                  */
/* ------------------------------------------------------------------ */
const EASE = 'cubic-bezier(0.4,0,0.2,1)';
const DURATION = 650;

type CarouselRole = 'center' | 'left' | 'right' | 'backLeft' | 'backRight';

/* ------------------------------------------------------------------ */
/*  Helper: merge DB row with visual meta                              */
/* ------------------------------------------------------------------ */
function mergeWithMeta(row: { id: string; name: string; points: number }): Character {
  const meta = CHARACTER_META[row.id] ?? { src: '', bg: '#666', panel: '#888' };
  return { ...row, ...meta };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function HeroCarousel() {
  const [characters, setCharacters] = useState<Character[]>(FALLBACK_CHARACTERS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const animLock = useRef(false);

  /* ---- preload images ---- */
  useEffect(() => {
    FALLBACK_CHARACTERS.forEach((c) => {
      const img = new Image();
      img.src = c.src;
    });
  }, []);

  /* ---- fetch initial data from Supabase ---- */
  useEffect(() => {
    const fetchData = async () => {
      const { data, error } = await supabase
        .from('characters')
        .select('id, name, points')
        .order('id');

      if (!error && data && data.length > 0) {
        setCharacters(data.map(mergeWithMeta));
        setDbReady(true);
      } else {
        console.warn('Supabase fetch failed or empty, using fallback:', error?.message);
        setDbReady(false);
      }
    };
    fetchData();
  }, []);

  /* ---- realtime subscription ---- */
  useEffect(() => {
    const channel = supabase
      .channel('characters-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'characters' },
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = payload.new as { id: string; name: string; points: number };
            setCharacters((prev) =>
              prev.map((c) =>
                c.id === updated.id ? { ...c, points: updated.points } : c,
              ),
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /* ---- responsive ---- */
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /* ---- navigation ---- */
  const navigate = useCallback((dir: 'next' | 'prev') => {
    if (animLock.current) return;
    animLock.current = true;
    setActiveIndex((prev) =>
      dir === 'next' ? (prev + 1) % COUNT : (prev + COUNT - 1) % COUNT,
    );
    setTimeout(() => {
      animLock.current = false;
    }, DURATION);
  }, []);

  /* ---- keyboard nav ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navigate('prev');
      if (e.key === 'ArrowRight') navigate('next');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  /* ---- update points (optimistic + Supabase write) ---- */
  const updatePoints = useCallback(
    async (id: string, delta: number) => {
      // Optimistic local update
      setCharacters((prev) =>
        prev.map((c) => (c.id === id ? { ...c, points: c.points + delta } : c)),
      );

      if (dbReady) {
        // Get current value from local state for the update
        const current = characters.find((c) => c.id === id);
        if (!current) return;

        const { error } = await supabase
          .from('characters')
          .update({ points: current.points + delta })
          .eq('id', id);

        if (error) {
          console.error('Supabase update failed:', error.message);
          // Revert on failure
          setCharacters((prev) =>
            prev.map((c) => (c.id === id ? { ...c, points: c.points - delta } : c)),
          );
        }
      }
    },
    [dbReady, characters],
  );

  /* ---- leaderboard ---- */
  const sortedLeaderboard = useMemo(
    () => [...characters].sort((a, b) => b.points - a.points),
    [characters],
  );

  /* ---- roles for 5 elements ---- */
  const roles: Record<number, CarouselRole> = {
    [activeIndex]:               'center',
    [(activeIndex + 4) % COUNT]: 'left',
    [(activeIndex + 1) % COUNT]: 'right',
    [(activeIndex + 3) % COUNT]: 'backLeft',
    [(activeIndex + 2) % COUNT]: 'backRight',
  };

  /* ---- per-role style builder ---- */
  const getSlotStyle = (role: CarouselRole): React.CSSProperties => {
    const t = `transform ${DURATION}ms ${EASE}, filter ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}, left ${DURATION}ms ${EASE}, bottom ${DURATION}ms ${EASE}, height ${DURATION}ms ${EASE}`;

    const base: React.CSSProperties = {
      position: 'absolute',
      aspectRatio: '0.6 / 1',
      transition: t,
      willChange: 'transform, filter, opacity',
    };

    switch (role) {
      case 'center':
        return { ...base, transform: `translateX(-50%) scale(${isMobile ? 1.25 : 1.68})`, filter: 'blur(0px)', opacity: 1, zIndex: 20, left: '50%', height: isMobile ? '60%' : '92%', bottom: isMobile ? '22%' : '0' };
      case 'left':
        return { ...base, transform: 'translateX(-50%) scale(1)', filter: 'blur(2px)', opacity: 0.85, zIndex: 10, left: isMobile ? '18%' : '28%', height: isMobile ? '16%' : '28%', bottom: isMobile ? '32%' : '12%' };
      case 'right':
        return { ...base, transform: 'translateX(-50%) scale(1)', filter: 'blur(2px)', opacity: 0.85, zIndex: 10, left: isMobile ? '82%' : '72%', height: isMobile ? '16%' : '28%', bottom: isMobile ? '32%' : '12%' };
      case 'backLeft':
        return { ...base, transform: 'translateX(-50%) scale(0.8)', filter: 'blur(6px)', opacity: 0.5, zIndex: 5, left: isMobile ? '8%' : '18%', height: isMobile ? '12%' : '20%', bottom: isMobile ? '34%' : '14%' };
      case 'backRight':
        return { ...base, transform: 'translateX(-50%) scale(0.8)', filter: 'blur(6px)', opacity: 0.5, zIndex: 5, left: isMobile ? '92%' : '82%', height: isMobile ? '12%' : '20%', bottom: isMobile ? '34%' : '14%' };
    }
  };

  const active = characters[activeIndex];
  const rankLabel = (i: number) => `${i + 1}º`;

  /* ================================================================ */
  return (
    <div
      style={{
        backgroundColor: active.bg,
        transition: `background-color ${DURATION}ms ${EASE}`,
        fontFamily: "'Inter', sans-serif",
      }}
      className="relative w-full overflow-hidden"
    >
      <div className="relative w-full" style={{ height: '100vh', overflow: 'hidden' }}>
        {/* 1 — grain overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 50, backgroundImage: GRAIN_SVG, backgroundSize: '200px 200px', backgroundRepeat: 'repeat', opacity: 0.4 }}
        />

        {/* 2 — ghost text */}
        <div className="absolute inset-x-0 flex items-center justify-center pointer-events-none select-none" style={{ zIndex: 2, top: '18%' }}>
          <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 'clamp(70px, 20vw, 300px)', fontWeight: 900, color: '#fff', opacity: 0.08, lineHeight: 1, textTransform: 'uppercase', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
            PUNTOS MAMI
          </span>
        </div>

        {/* 3 — top-left label */}
        <span className="absolute top-6 left-4 sm:left-8 text-xs font-semibold uppercase" style={{ zIndex: 60, color: '#fff', opacity: 0.9, letterSpacing: '0.18em' }}>
          RANKING FAMILIAR
        </span>

        {/* connection indicator */}
        <div className="absolute top-6 right-4 sm:right-8 flex items-center gap-2" style={{ zIndex: 60 }}>
          <span className={`w-2 h-2 rounded-full ${dbReady ? 'bg-green-400' : 'bg-yellow-400'} animate-pulse`} />
          <span className="text-white/60 text-xs">{dbReady ? 'En vivo' : 'Local'}</span>
        </div>

        {/* 4 — carousel */}
        <div className="absolute inset-0" style={{ zIndex: 3 }}>
          {characters.map((char, i) => (
            <div key={char.id} style={getSlotStyle(roles[i] ?? 'backRight')}>
              <img src={char.src} alt={char.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'bottom center' }} />
            </div>
          ))}
        </div>

        {/* 5 — bottom-left controls */}
        <div className="absolute bottom-6 left-4 sm:bottom-20 sm:left-24" style={{ zIndex: 60, maxWidth: 320 }}>
          <p className="mb-2 sm:mb-3 text-3xl sm:text-5xl" style={{ fontFamily: "'Anton', sans-serif", textTransform: 'uppercase', letterSpacing: '0.1em', color: '#fff', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.18))' }}>
            {active.name}
          </p>
          <p className="hidden sm:block text-xs sm:text-sm mb-4 sm:mb-5" style={{ color: '#fff', opacity: 0.85, lineHeight: 1.6 }}>
            ¡Vota por tu favorito para que suba en el ranking de Puntos de Mami! ¿Quién se ha portado mejor hoy?
          </p>
          <div className="flex gap-3">
            {(['prev', 'next'] as const).map((dir) => (
              <button
                key={dir}
                id={`nav-${dir}`}
                onClick={() => navigate(dir)}
                className="flex items-center justify-center cursor-pointer"
                style={{ width: isMobile ? 48 : 64, height: isMobile ? 48 : 64, borderRadius: '50%', background: 'transparent', border: '2px solid #fff', color: '#fff', transition: 'transform 150ms, background-color 150ms' }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                aria-label={dir === 'prev' ? 'Anterior' : 'Siguiente'}
              >
                {dir === 'prev' ? <ArrowLeft size={26} strokeWidth={2.25} /> : <ArrowRight size={26} strokeWidth={2.25} />}
              </button>
            ))}
          </div>
        </div>

        {/* 6 — leaderboard */}
        <div className="absolute top-20 right-4 sm:top-12 sm:right-10 w-80 sm:w-96" style={{ zIndex: 60 }}>
          <div className="rounded-2xl p-5 sm:p-7 shadow-2xl" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.25)' }}>
            <h2 className="text-2xl sm:text-3xl tracking-wide text-white mb-5" style={{ fontFamily: "'Anton', sans-serif", textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
              🏆 PUNTOS DE MAMI
            </h2>

            {sortedLeaderboard.map((char, i) => (
              <div key={char.id} className="flex items-center justify-between mb-4 last:mb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full shrink-0"
                    style={{ background: i === 0 ? 'rgba(255,215,0,0.35)' : 'rgba(255,255,255,0.15)', color: i === 0 ? '#FFD700' : 'rgba(255,255,255,0.7)' }}
                  >
                    {rankLabel(i)}
                  </span>
                  <span className="text-white font-bold text-base sm:text-lg truncate">{char.name}</span>
                </div>

                <span className="text-sm sm:text-base font-extrabold text-white px-3 py-1.5 rounded-lg shrink-0 mx-2" style={{ background: 'rgba(255,255,255,0.25)', textShadow: '0 1px 3px rgba(0,0,0,0.2)' }}>
                  {char.points}
                </span>

                <div className="flex items-center gap-1 shrink-0">
                  {([1, -1] as const).map((delta) => (
                    <button
                      key={delta}
                      id={`vote-${delta > 0 ? 'plus' : 'minus'}-${char.id}`}
                      onClick={() => updatePoints(char.id, delta)}
                      className="flex items-center justify-center p-2 rounded-full cursor-pointer"
                      style={{ color: '#fff', background: 'transparent', border: 'none', transition: 'background-color 150ms' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.30)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      aria-label={`${delta > 0 ? 'Sumar' : 'Restar'} punto a ${char.name}`}
                    >
                      {delta > 0 ? <Plus size={18} strokeWidth={2.5} /> : <Minus size={18} strokeWidth={2.5} />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
