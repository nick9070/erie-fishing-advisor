import { useState } from 'react'

const LURES = [
  'Tube jig', 'Drop-shot goby', 'Ned rig', 'Swimbait', 'Jerkbait',
  'Crankbait', 'Finesse worm', 'Ned goby', 'Blade bait', 'Topwater', 'Other'
]

const TECHNIQUES = [
  'Drop-shot', 'Dragging', 'Hopping', 'Swimming', 'Drifting', 'Anchored'
]

export default function CatchLogModal({ spot, conditions, apiBase, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0]
  const nowTime = new Date().toTimeString().slice(0, 5)

  const [form, setForm] = useState({
    fish_date: today,
    fish_time: nowTime,
    fish_count: 1,
    avg_length_in: '',
    best_length_in: '',
    depth_ft: '',
    lure: '',
    technique: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSave = async () => {
    if (!form.fish_count || form.fish_count < 1) {
      setError('Fish count must be at least 1')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/catches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_id: spot.spot_id,
          spot_name: spot.spot_name,
          ...form,
          fish_count: Number(form.fish_count),
          avg_length_in: form.avg_length_in ? Number(form.avg_length_in) : null,
          best_length_in: form.best_length_in ? Number(form.best_length_in) : null,
          depth_ft: form.depth_ft ? Number(form.depth_ft) : null,
          score_at_time: spot.score,
          water_temp_f: conditions?.water_temp_f,
          air_temp_f: conditions?.temp_f,
          pressure_hpa: conditions?.pressure_hpa,
          pressure_trend: conditions?.pressure_trend,
          wind_speed_mph: conditions?.wind_speed_mph,
          wind_dir: conditions?.wind_dir_label,
          conditions: conditions?.conditions,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      onSaved?.()
      onClose()
    } catch (e) {
      setError('Could not save catch. Check server connection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Log a Catch</div>
            <div className="modal-subtitle">{spot.spot_name}</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <Field label="Date">
              <input type="date" value={form.fish_date} onChange={e => set('fish_date', e.target.value)} />
            </Field>
            <Field label="Time">
              <input type="time" value={form.fish_time} onChange={e => set('fish_time', e.target.value)} />
            </Field>
          </div>

          <div className="form-row">
            <Field label="Fish Count">
              <input type="number" min="1" max="99" value={form.fish_count}
                onChange={e => set('fish_count', e.target.value)} />
            </Field>
            <Field label="Avg Length (in)">
              <input type="number" step="0.5" min="6" max="30" placeholder="e.g. 15.5"
                value={form.avg_length_in} onChange={e => set('avg_length_in', e.target.value)} />
            </Field>
            <Field label="Best Fish (in)">
              <input type="number" step="0.5" min="6" max="30" placeholder="e.g. 18"
                value={form.best_length_in} onChange={e => set('best_length_in', e.target.value)} />
            </Field>
          </div>

          <div className="form-row">
            <Field label="Depth (ft)">
              <input type="number" step="1" min="1" max="100" placeholder="e.g. 22"
                value={form.depth_ft} onChange={e => set('depth_ft', e.target.value)} />
            </Field>
            <Field label="Lure / Bait">
              <select value={form.lure} onChange={e => set('lure', e.target.value)}>
                <option value="">— select —</option>
                {LURES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Technique">
              <select value={form.technique} onChange={e => set('technique', e.target.value)}>
                <option value="">— select —</option>
                {TECHNIQUES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Conditions auto-logged">
            <div className="conditions-preview">
              {conditions?.water_temp_f && <span>💧 {conditions.water_temp_f}°F water</span>}
              {conditions?.wind_speed_mph && <span>💨 {Math.round(conditions.wind_speed_mph)} mph {conditions.wind_dir_label}</span>}
              {conditions?.pressure_trend && <span>📊 {conditions.pressure_trend}</span>}
              <span>⭐ App score: {spot.score}</span>
            </div>
          </Field>

          <Field label="Notes">
            <textarea
              placeholder="Structure found, presentation details, anything useful..."
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={3}
            />
          </Field>

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : '✓ Log Catch'}
          </button>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}

const styles = `
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal {
  background: #0d1f2d;
  border: 1px solid #1e3a4a;
  border-radius: 12px;
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 25px 60px rgba(0,0,0,0.6);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px 20px 14px;
  border-bottom: 1px solid #1e3a4a;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: #e2e8f0;
}

.modal-subtitle {
  font-size: 12px;
  color: #38bdf8;
  margin-top: 2px;
}

.modal-close {
  background: none;
  border: none;
  color: #64748b;
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}
.modal-close:hover { color: #e2e8f0; background: #1e3a4a; }

.modal-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  gap: 10px;
}

.form-row .field { flex: 1; }

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.field input,
.field select,
.field textarea {
  background: #0a1a2a;
  border: 1px solid #1e3a4a;
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 13px;
  padding: 7px 10px;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  outline: none;
  border-color: #38bdf8;
}

.field textarea { resize: vertical; min-height: 64px; }

.conditions-preview {
  background: #0a1a2a;
  border: 1px solid #1e3a4a;
  border-radius: 6px;
  padding: 7px 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: #94a3b8;
}

.form-error {
  background: #450a0a;
  border: 1px solid #7f1d1d;
  color: #fca5a5;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 6px;
}

.modal-footer {
  padding: 14px 20px;
  border-top: 1px solid #1e3a4a;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.btn-cancel {
  background: #0a1a2a;
  border: 1px solid #1e3a4a;
  color: #94a3b8;
  padding: 8px 18px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.btn-cancel:hover { background: #1e3a4a; }

.btn-save {
  background: #0ea5e9;
  border: none;
  color: #fff;
  padding: 8px 22px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  transition: background 0.15s;
}
.btn-save:hover:not(:disabled) { background: #38bdf8; }
.btn-save:disabled { opacity: 0.5; cursor: default; }
`
