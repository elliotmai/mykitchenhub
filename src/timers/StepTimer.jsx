// src/timers/StepTimer.jsx
// The timer button under a recipe step that says how long to wait
// ("Simmer for 10 minutes"): starts a shared kitchen timer, shows what is
// left, and stops it on a second tap.

import React from 'react';
import { Button } from 'react-bootstrap';
import { Timer } from 'lucide-react';

import { useOptionalTimers } from './TimersProvider';
import { isDone, stepKey, stepMinutes, timerForKey, timerText } from './timerLogic';

const StepTimer = ({ recipeId, recipeName, index, text }) => {
  const timers = useOptionalTimers();
  const minutes = stepMinutes(text);
  if (!timers || !minutes || !recipeId) return null;

  const key = stepKey(recipeId, index);
  const running = timerForKey(timers.timers, key);
  const label = `${recipeName ? `${recipeName}, ` : ''}step ${index + 1}`;
  const done = running && isDone(running, timers.now);

  return (
    <Button
      size="sm"
      variant={running ? (done ? 'danger' : 'primary') : 'outline-secondary'}
      className="kitchen-timer-step"
      onClick={() => timers.toggle(key, minutes, label)}
    >
      <Timer size={14} aria-hidden="true" />
      {running
        ? done
          ? 'Done. Tap to stop'
          : `${timerText(running, timers.now)} left. Tap to stop`
        : `Start a ${minutes} minute timer`}
    </Button>
  );
};

export default StepTimer;
