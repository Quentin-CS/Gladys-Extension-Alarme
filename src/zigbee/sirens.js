export function buildSirenCommand(
  settings,
  capabilities,
  { active, alertType = 'intrusion', fallbackDuration = 180 },
) {
  const behavior = settings.alertBehaviors?.[alertType] ?? {};
  if (active && behavior.enabled === false) return null;
  if (capabilities.includes('warning')) {
    const warning = {
      mode: active ? (behavior.mode ?? 'burglar') : 'stop',
      duration: active ? (behavior.duration ?? settings.duration ?? fallbackDuration) : 0,
    };
    if (capabilities.includes('level')) warning.level = behavior.volume ?? settings.volume;
    if (capabilities.includes('strobe')) warning.strobe = behavior.strobe ?? settings.strobe;
    return { warning };
  }
  if (capabilities.includes('alarm')) return { alarm: active ? 'START' : 'OFF' };
  return null;
}
