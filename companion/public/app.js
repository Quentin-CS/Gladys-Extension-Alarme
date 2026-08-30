const translations = {
  fr: {
    login: 'Administration',
    password: 'Mot de passe',
    connect: 'Se connecter',
    overview: 'Vue d’ensemble',
    devices: 'Équipements',
    zones: 'Zones',
    delays: 'Délais',
    keypads: 'Claviers',
    sirens: 'Sirènes et panique',
    users: 'Utilisateurs et codes',
    health: 'Santé MQTT et Zigbee',
    events: 'Journal',
    maintenance: 'Sauvegarde et maintenance',
    httpWarning:
      'HTTP local : le trafic n’est pas chiffré. Utilisez uniquement un réseau local de confiance.',
  },
  en: {
    login: 'Administration',
    password: 'Password',
    connect: 'Sign in',
    overview: 'Overview',
    devices: 'Devices',
    zones: 'Zones',
    delays: 'Delays',
    keypads: 'Keypads',
    sirens: 'Sirens and panic',
    users: 'Users and codes',
    health: 'MQTT and Zigbee health',
    events: 'Event log',
    maintenance: 'Backup and maintenance',
    httpWarning: 'Local HTTP: traffic is not encrypted. Only use on a trusted local network.',
  },
};

let language = 'fr';
let csrfToken;
let currentPage = 'overview';
const generatedFrench = {
  Name: 'Nom',
  Model: 'Modèle',
  Type: 'Type',
  Online: 'En ligne',
  Battery: 'Batterie',
  'Last seen': 'Dernière activité',
  Search: 'Rechercher',
  Page: 'Page',
  Apply: 'Appliquer',
  Profile: 'Profil',
  Create: 'Créer',
  Zone: 'Zone',
  Device: 'Équipement',
  Assign: 'Associer',
  Unassign: 'Dissocier',
  Confirmation: 'Confirmation',
  'Delete zone': 'Supprimer la zone',
  Active: 'Active',
  Entry: 'Entrée',
  Exit: 'Sortie',
  Trigger: 'Déclenchement',
  Open: 'Capteur actif',
  Bypass: 'Contournement',
  Save: 'Enregistrer',
  Enabled: 'Activée',
  Duration: 'Durée',
  Volume: 'Volume',
  Strobe: 'Flash',
  'Audible alerts': 'Alertes sonores',
  Users: 'Utilisateurs',
  Expires: 'Expiration',
  Duress: 'Contrainte',
  Operations: 'Opérations',
  Modes: 'Modes',
  'Optional UTC schedule': 'Horaire UTC facultatif',
  Start: 'Début',
  End: 'Fin',
  Disable: 'Désactiver',
  Enable: 'Activer',
  Offline: 'Hors ligne',
  'Device type': "Type d'équipement",
  'Offline timeout (seconds)': "Délai d'inactivité (secondes)",
  'Battery low': 'Batterie faible',
  'Export NDJSON': 'Exporter en NDJSON',
  'Type DELETE to clear the journal': 'Saisissez DELETE pour effacer le journal',
  'Clear journal': 'Effacer le journal',
  Passphrase: 'Phrase secrète',
  'Include log': 'Inclure le journal',
  'Export encrypted backup': 'Exporter la sauvegarde chiffrée',
  'Backup file': 'Fichier de sauvegarde',
  Restore: 'Restaurer',
  'New admin password': 'Nouveau mot de passe administrateur',
  'Change password': 'Modifier le mot de passe',
  yes: 'oui',
  no: 'non',
};
const q = (selector) => document.querySelector(selector);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};

function translate() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = translations[language][node.dataset.i18n];
  });
  q('#language').textContent = language === 'fr' ? 'EN' : 'FR';
}

function translateGenerated(root) {
  if (language !== 'fr') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const source = node.textContent.trim();
    if (generatedFrench[source]) node.textContent = generatedFrench[source];
  }
}

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error((await response.json()).error);
  return response.status === 204 ? null : response.json();
}

function table(rows, columns) {
  const wrapper = element('div');
  const output = element('table');
  const head = element('thead');
  const headRow = element('tr');
  for (const [key, label] of columns) headRow.append(element('th', label ?? key));
  head.append(headRow);
  const body = element('tbody');
  for (const row of rows) {
    const tr = element('tr');
    for (const [key] of columns) {
      const value = row[key];
      tr.append(element('td', typeof value === 'object' ? JSON.stringify(value) : (value ?? '')));
    }
    body.append(tr);
  }
  output.append(head, body);
  wrapper.append(output);
  return wrapper;
}

function formMarkup(content) {
  const form = element('form');
  form.className = 'inline';
  form.innerHTML = content;
  return form;
}

async function overview(content) {
  const data = await api('overview');
  const grid = element('div');
  grid.className = 'grid';
  for (const [label, value] of Object.entries({
    state: data.state.actualState,
    mode: data.state.requestedMode,
    MQTT: data.state.mqttAvailable ? 'OK' : 'OFFLINE',
    alarm: data.state.alarmLatched ? 'ACTIVE' : '—',
  })) {
    const metric = element('div', undefined, 'metric');
    metric.append(element('span', label), element('strong', value));
    grid.append(metric);
  }
  const actions = element('div', undefined, 'actions');
  for (const mode of ['disarmed', 'away', 'day', 'night']) {
    const button = element('button', mode);
    button.addEventListener('click', async () => {
      await api('control', { method: 'POST', body: JSON.stringify({ mode }) });
      await show('overview');
    });
    actions.append(button);
  }
  content.append(grid, actions);
}

async function devices(content) {
  const search = formMarkup(
    '<label>Search<input name="search"></label><label>Page<input name="page" type="number" min="1" value="1"></label><button>Apply</button>',
  );
  const results = element('div');
  const load = async () => {
    const data = await api(
      `devices?limit=50&page=${encodeURIComponent(search.elements.page.value)}&search=${encodeURIComponent(search.elements.search.value)}`,
    );
    results.replaceChildren(
      element('p', `${data.total} result(s)`),
      table(data.items, [
        ['friendly_name', 'Name'],
        ['model_id', 'Model'],
        ['kind', 'Type'],
        ['available', 'Online'],
        ['battery', 'Battery'],
        ['last_seen', 'Last seen'],
      ]),
    );
  };
  search.addEventListener('submit', async (event) => {
    event.preventDefault();
    await load();
  });
  content.append(search, results);
  await load();
}

async function zones(content) {
  const create = formMarkup(
    '<label>Name<input name="name" required maxlength="80"></label><label>Profile<select name="profile"><option value="perimeter">perimeter</option><option value="interior">interior</option><option value="entry">entry</option><option value="24h">24h</option><option value="tamper">tamper</option></select></label><button>Create</button>',
  );
  create.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(create);
    await api('zones', { method: 'POST', body: JSON.stringify(Object.fromEntries(values)) });
    await show('zones');
  });
  const [data, deviceData] = await Promise.all([api('zones'), api('devices?limit=200')]);
  const assign = formMarkup(
    '<label>Zone<select name="zone"></select></label><label>Device<select name="device"></select></label><button>Assign</button>',
  );
  for (const zone of data.items) assign.elements.zone.append(new Option(zone.name, zone.id));
  for (const device of deviceData.items)
    assign.elements.device.append(new Option(device.friendly_name, device.ieee_address));
  assign.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api(
      `zones/${encodeURIComponent(assign.elements.zone.value)}/devices/${encodeURIComponent(assign.elements.device.value)}`,
      { method: 'PUT', body: '{}' },
    );
    await show('zones');
  });
  content.append(
    create,
    assign,
    table(data.items, [['name'], ['profile'], ['devices'], ['modes']]),
  );
  for (const zone of data.items) {
    for (const ieeeAddress of zone.devices) {
      const unassign = formMarkup('<strong></strong><button>Unassign</button>');
      unassign.querySelector('strong').textContent = `${zone.name} / ${ieeeAddress}`;
      unassign.addEventListener('submit', async (event) => {
        event.preventDefault();
        await api(`zones/${zone.id}/devices/${encodeURIComponent(ieeeAddress)}`, {
          method: 'DELETE',
          body: '{}',
        });
        await show('zones');
      });
      content.append(unassign);
    }
    const remove = formMarkup(
      '<strong></strong><label>Confirmation<input name="confirmation" placeholder="DELETE"></label><button>Delete zone</button>',
    );
    remove.querySelector('strong').textContent = zone.name;
    remove.addEventListener('submit', async (event) => {
      event.preventDefault();
      await api(`zones/${zone.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: remove.elements.confirmation.value }),
      });
      await show('zones');
    });
    content.append(remove);
  }
}

async function delays(content) {
  const settings = await api('settings/alarm');
  const global = formMarkup(
    '<strong>Global defaults</strong><label>Entry<input name="entryDelay" type="number" min="0" max="86400"></label><label>Away exit<input name="away" type="number" min="0" max="86400"></label><label>Day exit<input name="day" type="number" min="0" max="86400"></label><label>Night exit<input name="night" type="number" min="0" max="86400"></label><label>Invalid attempts<input name="threshold" type="number" min="1" max="100"></label><label>Attempt window (s)<input name="windowSeconds" type="number" min="1" max="86400"></label><label>Lock duration (s)<input name="lockSeconds" type="number" min="1" max="604800"></label><button>Save defaults</button>',
  );
  global.elements.entryDelay.value = settings.entryDelay;
  global.elements.away.value = settings.exitDelays.away;
  global.elements.day.value = settings.exitDelays.day;
  global.elements.night.value = settings.exitDelays.night;
  global.elements.threshold.value = settings.pinAttempts.threshold;
  global.elements.windowSeconds.value = settings.pinAttempts.windowSeconds;
  global.elements.lockSeconds.value = settings.pinAttempts.lockSeconds;
  global.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('settings/alarm', {
      method: 'PUT',
      body: JSON.stringify({
        entryDelay: Number(global.elements.entryDelay.value),
        exitDelays: {
          away: Number(global.elements.away.value),
          day: Number(global.elements.day.value),
          night: Number(global.elements.night.value),
        },
        pinAttempts: {
          threshold: Number(global.elements.threshold.value),
          windowSeconds: Number(global.elements.windowSeconds.value),
          lockSeconds: Number(global.elements.lockSeconds.value),
        },
      }),
    });
  });
  content.append(global);
  const data = await api('zones');
  const rows = data.items.flatMap((zone) =>
    zone.modes.map((mode) => ({ zone: zone.name, ...mode })),
  );
  content.append(
    table(rows, [
      ['zone'],
      ['mode'],
      ['active'],
      ['entry_delay'],
      ['exit_delay'],
      ['trigger_mode'],
      ['open_behavior'],
      ['bypass_allowed'],
    ]),
  );
  for (const zone of data.items) {
    for (const mode of zone.modes) {
      const edit = formMarkup(
        '<strong></strong><label>Active<select name="active"><option value="true">yes</option><option value="false">no</option></select></label><label>Entry<input name="entryDelay" type="number" min="0" max="86400"></label><label>Exit<input name="exitDelay" type="number" min="0" max="86400"></label><label>Trigger<select name="triggerMode"><option value="immediate">immediate</option><option value="delayed">delayed</option></select></label><label>Open<select name="openBehavior"><option value="reject">reject</option><option value="bypass">bypass</option></select></label><label>Bypass<select name="bypassAllowed"><option value="false">no</option><option value="true">yes</option></select></label><button>Save</button>',
      );
      edit.querySelector('strong').textContent = `${zone.name} / ${mode.mode}`;
      edit.elements.active.value = String(Boolean(mode.active));
      edit.elements.entryDelay.value = mode.entry_delay;
      edit.elements.exitDelay.value = mode.exit_delay;
      edit.elements.triggerMode.value = mode.trigger_mode;
      edit.elements.openBehavior.value = mode.open_behavior;
      edit.elements.bypassAllowed.value = String(Boolean(mode.bypass_allowed));
      edit.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(edit));
        values.active = values.active === 'true';
        values.bypassAllowed = values.bypassAllowed === 'true';
        await api(`zones/${zone.id}/modes/${mode.mode}`, {
          method: 'PUT',
          body: JSON.stringify(values),
        });
      });
      content.append(edit);
    }
  }
}

async function keypads(content) {
  const data = await api('keypads');
  content.append(
    table(data.items, [
      ['friendly_name'],
      ['model_id'],
      ['available'],
      ['battery'],
      ['battery_low'],
      ['tamper'],
      ['last_seen'],
    ]),
  );
}

async function sirens(content) {
  const data = await api('sirens');
  const panic = formMarkup(
    `<label>Panic<select name="mode"><option value="audible">audible</option><option value="silent">silent</option></select></label><button>Save</button>`,
  );
  panic.elements.mode.value = data.panicMode;
  panic.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('settings/panic', {
      method: 'PUT',
      body: JSON.stringify({ mode: panic.elements.mode.value }),
    });
  });
  content.append(
    panic,
    table(data.items, [
      ['friendly_name'],
      ['enabled'],
      ['duration'],
      ['volume'],
      ['strobe'],
      ['available'],
      ['capabilities'],
    ]),
  );
  for (const siren of data.items) {
    const edit = formMarkup(
      '<strong></strong><label>Enabled<select name="enabled"><option value="true">yes</option><option value="false">no</option></select></label><label>Duration<input name="duration" type="number" min="1" max="3600"></label><label>Volume<select name="volume"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label><label>Strobe<select name="strobe"><option value="true">yes</option><option value="false">no</option></select></label><fieldset><legend>Audible alerts</legend><label><input name="audible" type="checkbox" value="intrusion" checked> intrusion</label><label><input name="audible" type="checkbox" value="tamper" checked> tamper</label><label><input name="audible" type="checkbox" value="panic" checked> panic</label></fieldset><button>Save</button>',
    );
    edit.querySelector('strong').textContent = siren.friendly_name;
    edit.elements.enabled.value = String(siren.enabled);
    edit.elements.duration.value = siren.duration;
    edit.elements.volume.value = siren.volume;
    edit.elements.strobe.value = String(siren.strobe);
    for (const checkbox of edit.querySelectorAll('[name="audible"]')) {
      checkbox.checked = siren.alert_behaviors[checkbox.value]?.enabled !== false;
    }
    edit.addEventListener('submit', async (event) => {
      event.preventDefault();
      await api(`sirens/${encodeURIComponent(siren.ieee_address)}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: edit.elements.enabled.value === 'true',
          duration: Number(edit.elements.duration.value),
          volume: edit.elements.volume.value,
          strobe: edit.elements.strobe.value === 'true',
          alertBehaviors: Object.fromEntries(
            ['intrusion', 'tamper', 'panic'].map((type) => [
              type,
              {
                enabled: [...edit.querySelectorAll('[name="audible"]')].some(
                  (checkbox) => checkbox.value === type && checkbox.checked,
                ),
              },
            ]),
          ),
        }),
      });
    });
    content.append(edit);
  }
}

async function users(content) {
  const create = formMarkup(
    '<label>Name<input name="name" required maxlength="80"></label><label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required></label><label>Expires<input name="expiresAt" type="datetime-local"></label><label>Duress<select name="duress"><option value="false">no</option><option value="true">yes</option></select></label><fieldset><legend>Operations</legend><label><input name="operations" type="checkbox" value="arm" checked> arm</label><label><input name="operations" type="checkbox" value="disarm" checked> disarm</label></fieldset><fieldset><legend>Modes</legend><label><input name="modes" type="checkbox" value="away" checked> away</label><label><input name="modes" type="checkbox" value="day" checked> day</label><label><input name="modes" type="checkbox" value="night" checked> night</label></fieldset><fieldset><legend>Optional UTC schedule</legend><label><input name="days" type="checkbox" value="1"> Mon</label><label><input name="days" type="checkbox" value="2"> Tue</label><label><input name="days" type="checkbox" value="3"> Wed</label><label><input name="days" type="checkbox" value="4"> Thu</label><label><input name="days" type="checkbox" value="5"> Fri</label><label><input name="days" type="checkbox" value="6"> Sat</label><label><input name="days" type="checkbox" value="0"> Sun</label><label>Start<input name="scheduleStart" type="time"></label><label>End<input name="scheduleEnd" type="time"></label></fieldset><button>Create</button>',
  );
  create.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(create);
    const values = Object.fromEntries(formData);
    values.duress = values.duress === 'true';
    values.expiresAt = values.expiresAt ? new Date(values.expiresAt).toISOString() : null;
    values.operations = formData.getAll('operations');
    values.modes = formData.getAll('modes');
    const days = formData.getAll('days').map(Number);
    const minutes = (value) => {
      const [hours, minute] = value.split(':').map(Number);
      return hours * 60 + minute;
    };
    values.schedule = days.length
      ? [
          {
            days,
            start: minutes(values.scheduleStart),
            end: minutes(values.scheduleEnd),
          },
        ]
      : null;
    delete values.days;
    delete values.scheduleStart;
    delete values.scheduleEnd;
    await api('users', { method: 'POST', body: JSON.stringify(values) });
    create.reset();
    await show('users');
  });
  const data = await api('users');
  content.append(
    create,
    table(data.items, [
      ['name'],
      ['active'],
      ['duress'],
      ['expires_at'],
      ['operations'],
      ['modes'],
      ['created_at'],
    ]),
  );
  for (const user of data.items) {
    const status = formMarkup('<strong></strong><button></button>');
    status.querySelector('strong').textContent = user.name;
    status.querySelector('button').textContent = user.active ? 'Disable' : 'Enable';
    status.addEventListener('submit', async (event) => {
      event.preventDefault();
      await api(`users/${user.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ active: !user.active }),
      });
      await show('users');
    });
    content.append(status);
  }
}

async function health(content) {
  const data = await api('health');
  const timeout = formMarkup(
    '<label>Device type<input name="kind" value="contact" pattern="[a-z-]{2,30}" required></label><label>Offline timeout (seconds)<input name="seconds" type="number" min="60" max="604800" required></label><button>Save</button>',
  );
  timeout.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api(`settings/offline-timeout/${encodeURIComponent(timeout.elements.kind.value)}`, {
      method: 'PUT',
      body: JSON.stringify({ seconds: Number(timeout.elements.seconds.value) }),
    });
  });
  content.append(
    timeout,
    element(
      'p',
      `MQTT: ${data.mqttAvailable ? 'OK' : 'OFFLINE'}`,
      data.mqttAvailable ? 'ok' : 'warning',
    ),
    element('p', `Database: ${data.databaseBytes} bytes`),
    element('h3', 'Offline'),
    table(data.offline, [['friendly_name'], ['kind'], ['last_seen']]),
    element('h3', 'Battery low'),
    table(data.batteryLow, [['friendly_name'], ['kind'], ['battery']]),
  );
}

async function events(content) {
  const filters = formMarkup(
    '<label>Search<input name="search"></label><label>Type<input name="type"></label><label>Page<input name="page" type="number" min="1" value="1"></label><button>Apply</button>',
  );
  const results = element('div');
  const load = async () => {
    const data = await api(
      `events?limit=50&page=${encodeURIComponent(filters.elements.page.value)}&type=${encodeURIComponent(filters.elements.type.value)}&search=${encodeURIComponent(filters.elements.search.value)}`,
    );
    results.replaceChildren(
      element('p', `${data.total} event(s)`),
      table(data.items, [
        ['occurred_at'],
        ['type'],
        ['severity'],
        ['actor'],
        ['device'],
        ['details'],
      ]),
    );
  };
  filters.addEventListener('submit', async (event) => {
    event.preventDefault();
    await load();
  });
  const link = element('a', 'Export NDJSON');
  link.href = '/api/events-export';
  const clear = formMarkup(
    '<label>Type DELETE to clear the journal<input name="confirmation" autocomplete="off"></label><button>Clear journal</button>',
  );
  clear.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('events', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: clear.elements.confirmation.value }),
    });
    clear.reset();
    await load();
  });
  content.append(filters, link, results, clear);
  await load();
}

async function maintenance(content) {
  const backup = formMarkup(
    '<label>Passphrase<input name="passphrase" type="password" minlength="12" required></label><label>Include log<select name="includeEvents"><option value="false">no</option><option value="true">yes</option></select></label><button>Export encrypted backup</button>',
  );
  backup.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api('backup', {
      method: 'POST',
      body: JSON.stringify({
        passphrase: backup.elements.passphrase.value,
        includeEvents: backup.elements.includeEvents.value === 'true',
      }),
    });
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'gladys-alarm-backup.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  const password = formMarkup(
    '<label>New admin password<input name="password" type="password" minlength="12" required></label><button>Change password</button>',
  );
  password.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('password', {
      method: 'POST',
      body: JSON.stringify({ password: password.elements.password.value }),
    });
    location.reload();
  });
  const restore = formMarkup(
    '<label>Backup file<input name="file" type="file" accept="application/json" required></label><label>Passphrase<input name="passphrase" type="password" minlength="12" required></label><button>Restore</button>',
  );
  restore.addEventListener('submit', async (event) => {
    event.preventDefault();
    const backupFile = JSON.parse(await restore.elements.file.files[0].text());
    await api('restore', {
      method: 'POST',
      body: JSON.stringify({
        backup: backupFile,
        passphrase: restore.elements.passphrase.value,
      }),
    });
    await show('overview');
  });
  content.append(backup, restore, password);
}

const renderers = {
  overview,
  devices,
  zones,
  delays,
  keypads,
  sirens,
  users,
  health,
  events,
  maintenance,
};
async function show(page) {
  currentPage = page;
  q('#page-title').textContent = translations[language][page];
  const content = q('#content');
  content.replaceChildren();
  try {
    await renderers[page](content);
    translateGenerated(content);
  } catch (error) {
    content.append(element('p', error.message, 'error'));
  }
}

q('#login form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('login', {
      method: 'POST',
      body: JSON.stringify({ password: q('#login input').value }),
    });
    csrfToken = result.csrfToken;
    q('#login').hidden = true;
    q('#application').hidden = false;
    await show('overview');
  } catch (error) {
    q('.error').textContent = error.message;
  }
});
document
  .querySelectorAll('[data-page]')
  .forEach((button) => button.addEventListener('click', () => show(button.dataset.page)));
q('#language').addEventListener('click', () => {
  language = language === 'fr' ? 'en' : 'fr';
  translate();
  show(currentPage);
});
translate();
