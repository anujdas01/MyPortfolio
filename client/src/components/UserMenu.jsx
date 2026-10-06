import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Settings, UserCog } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ProfileModal from './ProfileModal.jsx';

function initials(user) {
  const name = (user?.displayName || user?.username || '?').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).slice(0, 2);
  return name.slice(0, 2);
}

export default function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  if (!user) return null;

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  const openProfile = () => {
    setOpen(false);
    setProfileOpen(true);
  };

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Your profile"
          className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2 transition-colors hover:border-primary/40 hover:bg-surfaceAlt"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold uppercase text-onPrimary">
            {initials(user)}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm font-medium lg:inline">
            {user.displayName || user.username}
          </span>
          <ChevronDown
            size={13}
            className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div
            role="menu"
            className="anim-pop absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
          >
            <div className="border-b border-border px-4 py-3">
              <p className="truncate font-medium">{user.displayName || user.username}</p>
              <p className="truncate text-xs text-muted">
                @{user.username} · {user.role}
              </p>
            </div>
            <button
              role="menuitem"
              onClick={openProfile}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-surfaceAlt"
            >
              <UserCog size={15} className="text-muted" />
              Edit profile
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate('/settings');
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-surfaceAlt"
            >
              <Settings size={15} className="text-muted" />
              Settings
            </button>
            <div className="border-t border-border">
              <button
                role="menuitem"
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-negative transition-colors hover:bg-negative/10"
              >
                <LogOut size={15} />
                Log out
              </button>
            </div>
          </div>
        )}
      </div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}