import React, { useState } from 'react';
import { AlertCircle, Save, History, ChevronDown } from 'lucide-react';
import { todayISO, money, formatDate } from '../utils/format.js';
import { KIND_LABELS, KIND_GROUPS, kindLabel } from '../utils/accountKinds.js';
import { inputCls, labelCls, errorCls, btnPrimary } from '../styles.js';

export { KIND_LABELS, KIND_GROUPS, kindLabel };

export default function AccountForm({ categories, initial, history = [], onSubmit, busy, error }) {
  const isNew = !initial;
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    institution: initial?.institution || '',
    categoryId: initial?.categoryId || categories[0]?.id || '',
    kind: initial?.kind || '',
    isAsset: initial ? !!initial.isAsset : true,
    notes: initial?.notes || '',
    archived: initial ? !!initial.archived : false,
  }));
  const [openingValue, setOpeningValue] = useState('');
  const [openingDate, setOpeningDate] = useState(todayISO());
  const [balanceValue, setBalanceValue] = useState('');
  const [balanceDate, setBalanceDate] = useState(todayISO());
  const [historyOpen, setHistoryOpen] = useState(true);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      ...form,
      kind: form.kind || null,
      categoryId: Number(form.categoryId),
      ...(isNew && openingValue !== ''
        ? { opening: { value: Number(openingValue), asOfDate: openingDate } }
        : {}),
      ...(!isNew && balanceValue !== ''
        ? { balanceUpdate: { value: Number(balanceValue), asOfDate: balanceDate } }
        : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={labelCls} htmlFor="af-name">Name</label>
        <input id="af-name" required value={form.name} onChange={set('name')} placeholder="e.g. Fidelity Brokerage" className={inputCls} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="af-cat">Category</label>
          <select id="af-cat" value={form.categoryId} onChange={set('categoryId')} className={inputCls}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="af-kind">Type</label>
          <select id="af-kind" value={form.kind} onChange={set('kind')} className={inputCls}>
            <option value="">— none —</option>
            {KIND_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.kinds.map((k) => (
                  <option key={k} value={k}>{kindLabel(k)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls} htmlFor="af-inst">Institution</label>
        <input id="af-inst" value={form.institution} onChange={set('institution')} placeholder="e.g. Vanguard" className={inputCls} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={form.isAsset} onChange={set('isAsset')} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]" />
        This is an asset (uncheck for a liability such as a mortgage or loan)
      </label>

      {isNew && (
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Opening balance (optional)
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px]">
            <div>
              <label className={labelCls} htmlFor="af-opening-value">Value ($)</label>
              <input
                id="af-opening-value"
                type="number"
                step="any"
                min={0}
                placeholder={form.isAsset ? 'e.g. 5000' : 'e.g. 250000'}
                value={openingValue}
                onChange={(e) => setOpeningValue(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="af-opening-date">As of</label>
              <input
                id="af-opening-date"
                type="date"
                max={todayISO()}
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Leave blank to add the balance later from the account page.</p>
        </fieldset>
      )}

      {!isNew && (
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Current balance
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px]">
            <div>
              <label className={labelCls} htmlFor="af-bal-value">New value ($)</label>
              <input
                id="af-bal-value"
                type="number"
                step="any"
                placeholder={
                  initial.latestValue !== null && initial.latestValue !== undefined
                    ? `currently ${initial.latestValue.toLocaleString('en-US')}`
                    : 'no balance recorded yet'
                }
                value={balanceValue}
                onChange={(e) => setBalanceValue(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="af-bal-date">As of</label>
              <input
                id="af-bal-date"
                type="date"
                max={todayISO()}
                value={balanceDate}
                onChange={(e) => setBalanceDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Enter a value to record a new balance entry (history is kept). Leave blank to leave it unchanged.
          </p>

          {history.length > 0 && (
            <div className="mt-3 rounded-md border border-border/70 bg-surfaceAlt/40">
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <History size={12} />
                  Recent balances ({history.length})
                </span>
                <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className="mp-collapse" data-open={historyOpen}>
                <div className="mp-collapse-inner">
                  <ul className="max-h-44 divide-y divide-border/60 overflow-y-auto border-t border-border/70">
                    {history.map((s, i) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="text-xs text-muted">{formatDate(s.asOfDate)}</span>
                        <span
                          className={`text-sm font-medium ${
                            i === 0
                              ? 'text-text'
                              : initial.isAsset
                                ? 'text-positive'
                                : 'text-negative'
                          }`}
                        >
                          {money(s.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </fieldset>
      )}

      <div>
        <label className={labelCls} htmlFor="af-notes">Notes</label>
        <textarea id="af-notes" rows={2} value={form.notes} onChange={set('notes')} className={inputCls} />
      </div>

      {error && (
        <p className={errorCls}>
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className={`${btnPrimary} w-full`}
      >
        <Save size={15} />
        {busy ? 'Saving…' : initial ? 'Save changes' : 'Create account'}
      </button>
    </form>
  );
}
