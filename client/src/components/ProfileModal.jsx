import React, { useEffect, useState } from 'react';
import { AtSign, KeyRound, ShieldCheck, User as UserIcon } from 'lucide-react';
import Modal from './Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { inputCls, labelCls, errorCls, btnPrimary, btnCancel } from '../styles.js';

export default function ProfileModal({ open, onClose }) {
  const { user, updateProfile } = useAuth();
  const { success, error } = useToast();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

  // Reseed from the live user each time the modal opens, so a previous
  // half-finished edit never leaks into the next visit.
  useEffect(() => {
    if (!open || !user) return;
    setDisplayName(user.displayName || '');
    setUsername(user.username || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFormError('');
  }, [open, user]);

  const nameChanged = displayName.trim() !== (user?.displayName || '');
  const usernameChanged = username.trim().toLowerCase() !== (user?.username || '').toLowerCase()
    && username.trim() !== '';
  const changingPassword = newPassword.length > 0 || confirmPassword.length > 0;
  const needsCurrentPassword = changingPassword || usernameChanged;
  const nothingToDo = !nameChanged && !usernameChanged && !changingPassword;

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (usernameChanged && !USERNAME_RE.test(username.trim())) {
      setFormError('Login name must be 3-32 characters (letters, numbers, _ . -)');
      return;
    }
    if (changingPassword && newPassword !== confirmPassword) {
      setFormError('New passwords do not match');
      return;
    }
    if (changingPassword && newPassword.length < 8) {
      setFormError('New password must be at least 8 characters');
      return;
    }
    if (needsCurrentPassword && !currentPassword) {
      setFormError(
        usernameChanged && !changingPassword
          ? 'Enter your current password to change your login name'
          : 'Enter your current password to change it'
      );
      return;
    }

    setBusy(true);
    try {
      const data = await updateProfile({
        displayName: nameChanged ? displayName.trim() : undefined,
        username: usernameChanged ? username.trim() : undefined,
        currentPassword: needsCurrentPassword ? currentPassword : undefined,
        newPassword: changingPassword ? newPassword : undefined,
      });
      success(
        data.usernameChanged && data.passwordChanged
          ? `Login name changed to @${data.user.username}; password changed`
          : data.usernameChanged
            ? `Login name changed to @${data.user.username} — use it next time you sign in`
            : data.passwordChanged
              ? 'Profile updated and password changed'
              : 'Profile updated'
      );
      onClose();
    } catch (err) {
      const msg =
        err.response?.status === 401 && needsCurrentPassword
          ? 'Current password is incorrect'
          : err.response?.data?.error || 'Could not save your profile';
      setFormError(msg);
      error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="Your profile">
      <form onSubmit={submit}>
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-border bg-surfaceAlt/50 p-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold uppercase text-onPrimary">
            {(user?.displayName || user?.username || '?').slice(0, 2)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{user?.displayName || user?.username}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted">
              <AtSign size={12} />
              {user?.username}
              <span className="text-border">|</span>
              <ShieldCheck size={12} />
              {user?.role}
            </p>
          </div>
        </div>

        <div className="mb-5">
          <label htmlFor="profile-display-name" className={labelCls}>
            Display name
          </label>
          <div className="relative">
            <UserIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              id="profile-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              placeholder={user?.username}
              className={`${inputCls} pl-9`}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            Shown next to your name in the header. Leave blank to fall back to your username.
          </p>
        </div>

        <div className="mb-5">
          <label htmlFor="profile-username" className={labelCls}>
            Login name
          </label>
          <div className="relative">
            <AtSign
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              id="profile-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
              placeholder={user?.username}
              autoComplete="username"
              className={`${inputCls} pl-9`}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            The name you sign in with (3-32 characters: letters, numbers, _ . -).
            {usernameChanged
              ? ' Changing it takes effect immediately — enter your current password below.'
              : ' Your current password is required to change it.'}
          </p>
        </div>

        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">Change password</legend>
          <label className="mb-1 flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
              className="rounded border-border"
            />
            Show passwords
          </label>

          <div className="mt-2 grid gap-3">
            <div>
              <label htmlFor="profile-current-password" className={labelCls}>
                Current password
              </label>
              <input
                id="profile-current-password"
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Required to change login name or password"
                className={inputCls}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="profile-new-password" className={labelCls}>
                  New password
                </label>
                <input
                  id="profile-new-password"
                  type={showPasswords ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="profile-confirm-password" className={labelCls}>
                  Confirm new password
                </label>
                <input
                  id="profile-confirm-password"
                  type={showPasswords ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <KeyRound size={12} className="mt-0.5 shrink-0" />
            Leave both fields blank to keep your current password. Changing it signs this device
            back in automatically.
          </p>
        </fieldset>

        {formError && (
          <p className={`${errorCls} mt-4`}>{formError}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={btnCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || nothingToDo}
            className={btnPrimary}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}