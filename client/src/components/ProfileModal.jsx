import React, { useEffect, useState } from 'react';
import { AtSign, KeyRound, ShieldCheck, User as UserIcon } from 'lucide-react';
import Modal from './Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

const inputCls =
  'w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none';
const labelCls = 'mb-1 block text-sm font-medium';

export default function ProfileModal({ open, onClose }) {
  const { user, updateProfile } = useAuth();
  const { success, error } = useToast();

  const [displayName, setDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Reseed from the live user each time the modal opens, so a previous
  // half-finished edit never leaks into the next visit.
  useEffect(() => {
    if (!open || !user) return;
    setDisplayName(user.displayName || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFormError('');
  }, [open, user]);

  const nameChanged = displayName.trim() !== (user?.displayName || '');
  const changingPassword = newPassword.length > 0 || confirmPassword.length > 0;
  const nothingToDo = !nameChanged && !changingPassword;

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (changingPassword && newPassword !== confirmPassword) {
      setFormError('New passwords do not match');
      return;
    }
    if (changingPassword && newPassword.length < 8) {
      setFormError('New password must be at least 8 characters');
      return;
    }
    if (changingPassword && !currentPassword) {
      setFormError('Enter your current password to change it');
      return;
    }

    setBusy(true);
    try {
      const data = await updateProfile({
        displayName: nameChanged ? displayName.trim() : undefined,
        currentPassword: changingPassword ? currentPassword : undefined,
        newPassword: changingPassword ? newPassword : undefined,
      });
      success(
        data.passwordChanged
          ? 'Profile updated and password changed'
          : 'Profile updated'
      );
      onClose();
    } catch (err) {
      const msg =
        err.response?.status === 401 && changingPassword
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
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold uppercase text-white">
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
                placeholder="Required to set a new password"
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
          <p className="mt-4 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{formError}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surfaceAlt disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || nothingToDo}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}