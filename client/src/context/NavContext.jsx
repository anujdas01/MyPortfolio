import React, { createContext, useContext, useEffect, useState } from 'react';

const POSITIONS = ['top', 'left'];
const STORAGE_KEY = 'mp-nav-position';

const NavContext = createContext(null);

export function NavProvider({ children }) {
  const [navPosition, setNavState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return POSITIONS.includes(stored) ? stored : 'top';
    } catch {
      return 'top';
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, navPosition); } catch {}
  }, [navPosition]);

  const setNavPosition = (p) => {
    if (!POSITIONS.includes(p)) return;
    setNavState(p);
  };

  return (
    <NavContext.Provider value={{ navPosition, setNavPosition }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNavPosition() {
  return useContext(NavContext);
}
