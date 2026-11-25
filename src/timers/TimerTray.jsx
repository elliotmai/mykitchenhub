// src/timers/TimerTray.jsx
// Running timers in a corner of every screen, and a way to start one.
// Tapping a running timer stops it (after asking); the clock button opens a
// short form for a timer typed in by hand.

import React, { useState } from 'react';
import { Button, Form, InputGroup } from 'react-bootstrap';
import { Timer, X } from 'lucide-react';

import { useTimers } from './TimersProvider';
import { isDone, timerText } from './timerLogic';

const QUICK = [1, 5, 10, 15];

const TimerTray = () => {
  const { timers, now, start, stop, error } = useTimers();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState(null);

  const begin = async (mins, name = label) => {
    const result = await start({ minutes: mins, label: name });
    if (result.success) {
      setOpen(false);
      setMinutes('');
      setLabel('');
      setProblem(null);
    } else {
      setProblem(result.error);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    begin(Number(minutes));
  };

  const cancel = (t) => {
    if (window.confirm(`Stop the ${t.label} timer?`)) stop(t.id);
  };

  return (
    <div className="kitchen-timer-tray" aria-label="Kitchen timers">
      {timers
        .filter((t) => !isDone(t, now))
        .map((t) => (
          <button
            key={t.id}
            type="button"
            className="kitchen-timer-chip"
            onClick={() => cancel(t)}
            aria-label={`${t.label}, ${timerText(t, now)} left. Tap to stop.`}
          >
            <Timer size={16} aria-hidden="true" />
            <span className="kitchen-timer-chip__label">{t.label}</span>
            <b>{timerText(t, now)}</b>
          </button>
        ))}

      {open ? (
        <Form className="kitchen-timer-form" onSubmit={submit}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <strong>New timer</strong>
            <Button
              variant="link"
              size="sm"
              className="p-0"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </Button>
          </div>
          <div className="d-flex gap-2 mb-2">
            {QUICK.map((m) => (
              <Button key={m} size="sm" variant="outline-primary" onClick={() => begin(m)}>
                {m} min
              </Button>
            ))}
          </div>
          <Form.Control
            className="mb-2"
            placeholder="What for? (optional)"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Timer name"
          />
          <InputGroup>
            <Form.Control
              type="number"
              min="1"
              max="1440"
              inputMode="numeric"
              placeholder="Minutes"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-label="Minutes"
            />
            <Button type="submit" disabled={!Number(minutes)}>
              Start
            </Button>
          </InputGroup>
          {(problem || error) && <div className="text-danger small mt-2">{problem || error}</div>}
        </Form>
      ) : (
        <button
          type="button"
          className="kitchen-timer-add"
          onClick={() => setOpen(true)}
          aria-label="Start a timer"
          title="Start a timer"
        >
          <Timer size={22} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default TimerTray;
