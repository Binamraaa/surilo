// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Binamra Bhusal
// The recording setup under "Start humming": hum to a beat or not, the tempo, how
// long the count-in is, and whether the phone buzzes on the beat. It's folded into
// one line ("Beat: Count me in · 90 BPM · 4/4") until opened, so the screen has one
// button to press. Saved on this device.
//
//   off         no tempo: record freely (as before)
//   countin     a bar or two of clicks, then silence while the dots keep the beat
//               (works on a phone speaker: no click reaches the mic during the hum)
//   throughout  the click plays all the way (needs headphones)

const STORE = 'hum-to-notes.recording';
const MODES = ['off', 'countin', 'throughout'];
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canVibrate = () => typeof navigator.vibrate === 'function';

function load() {
  const d = { mode: 'countin', bars: 1, vibrate: false, warned: false };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    return {
      mode: MODES.includes(s.mode) ? s.mode : d.mode,
      bars: s.bars === 2 ? 2 : 1,
      vibrate: !!s.vibrate,
      warned: !!s.warned,
    };
  } catch { return d; }
}

/**
 * @param {object} o
 * @param {{bpm:number, sig:string, stop():void, onChange(fn):void}} o.metro  the metronome panel (tempo and time signature)
 * @param {(msg:string, warn?:boolean) => void} o.say  show a message
 */
export function createRecordSetup({ metro, say }) {
  const $ = (id) => document.getElementById(id);
  const s = load();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode: just don't remember */ } };

  let open = false; // folded away until asked for

  function draw() {
    document.querySelectorAll('#click-mode [data-click]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.click === s.mode)));
    document.querySelectorAll('#count-in [data-bars]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.bars) === s.bars)));
    // No beat: no tempo to set. (The tempo controls belong to the beat.)
    if (s.mode === 'off') metro.stop();
    $('metro').hidden = s.mode === 'off';
    const names = { off: 'No beat', countin: 'Count me in', throughout: 'Keep clicking' };
    $('setup-sum').textContent = s.mode === 'off' ? 'No beat: hum freely' : `${names[s.mode]} · ${metro.bpm} BPM · ${metro.sig}`;
    $('setup-body').hidden = !open;
    $('setup-toggle').setAttribute('aria-expanded', String(open));
    $('rec-vibrate').hidden = s.mode === 'off' || !canVibrate();
    $('rec-vibrate').setAttribute('aria-pressed', String(s.vibrate));
    const hints = {
      off: 'Hum freely. You can set a tempo afterwards, on the Notes tab.',
      countin: 'You hear the clicks first, then hum while the dots keep the beat. The app lines your notes up with it.',
      throughout: 'The click plays the whole time. Use headphones, or the mic hears it.',
    };
    $('rec-hint').textContent = hints[s.mode] + (s.mode !== 'off' && isIOS() ? ' Can\'t hear the click? Turn off silent mode.' : '');
  }

  $('click-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-click]');
    if (!b) return;
    s.mode = b.dataset.click;
    if (s.mode === 'throughout' && !s.warned) {
      s.warned = true;
      say('Plug in headphones for "Keep clicking". Without them the mic hears the click.', true);
    }
    save(); draw();
  });
  $('count-in').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bars]');
    if (!b) return;
    s.bars = Number(b.dataset.bars);
    save(); draw();
  });
  $('rec-vibrate').addEventListener('click', () => { s.vibrate = !s.vibrate; save(); draw(); });
  $('setup-toggle').addEventListener('click', () => { open = !open; draw(); });
  metro.onChange(draw);
  draw();

  return {
    get mode() { return s.mode; },
    get bars() { return s.bars; },
    get vibrate() { return s.vibrate && canVibrate(); },
    /** Open the setup and bring it into view (the floating tempo pill does this). */
    show() { open = true; draw(); $('rec-setup').scrollIntoView({ block: 'center' }); },
  };
}
