const express = require('express');
const cors = require('cors');
const { STATE_DATA, CITY_AQI, STATE_COORDS } = require('./data');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ── HELPER ────────────────────────────────────────────────────────────────────
const getAvgAQI = (stateName) => {
  const cities = CITY_AQI.filter(c => c.state === stateName);
  if (!cities.length) return null;
  return parseFloat((cities.reduce((a, c) => a + c.aqi, 0) / cities.length).toFixed(1));
};

// ── ROUTES ────────────────────────────────────────────────────────────────────

// GET /api/states — all states with coords + avg AQI
app.get('/api/states', (req, res) => {
  const data = STATE_DATA.map(s => ({
    ...s,
    coords: STATE_COORDS[s.state] || null,
    avgAQI: getAvgAQI(s.state),
  }));
  res.json({ success: true, count: data.length, data });
});

// GET /api/states/:name — single state full detail
app.get('/api/states/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const state = STATE_DATA.find(s => s.state.toLowerCase() === name.toLowerCase());
  if (!state) return res.status(404).json({ success: false, message: 'State not found' });

  const cities = CITY_AQI
    .filter(c => c.state === state.state)
    .sort((a, b) => b.aqi - a.aqi);

  res.json({
    success: true,
    data: {
      ...state,
      coords: STATE_COORDS[state.state] || null,
      avgAQI: getAvgAQI(state.state),
      cities,
      crimeChange: parseFloat(((state.rates[2] - state.rates[0]) / state.rates[0] * 100).toFixed(1)),
    }
  });
});

// GET /api/cities — all cities AQI
app.get('/api/cities', (req, res) => {
  const { state } = req.query;
  let data = state
    ? CITY_AQI.filter(c => c.state.toLowerCase() === state.toLowerCase())
    : CITY_AQI;
  data = data.sort((a, b) => b.aqi - a.aqi);
  res.json({ success: true, count: data.length, data });
});

// GET /api/ranking?indicator=crime|aqi|literacy|population — sorted ranking
app.get('/api/ranking', (req, res) => {
  const { indicator = 'crime', limit = 36 } = req.query;
  let sorted;

  if (indicator === 'crime') {
    sorted = [...STATE_DATA]
      .filter(s => s.rates[2] < 200)
      .sort((a, b) => b.rates[2] - a.rates[2]);
  } else if (indicator === 'aqi') {
    sorted = [...STATE_DATA]
      .map(s => ({ ...s, avgAQI: getAvgAQI(s.state) }))
      .filter(s => s.avgAQI)
      .sort((a, b) => b.avgAQI - a.avgAQI);
  } else if (indicator === 'literacy') {
    sorted = [...STATE_DATA].sort((a, b) => b.literacy - a.literacy);
  } else if (indicator === 'population') {
    sorted = [...STATE_DATA].sort((a, b) => b.pop - a.pop);
  } else {
    return res.status(400).json({ success: false, message: 'Invalid indicator' });
  }

  res.json({ success: true, indicator, data: sorted.slice(0, parseInt(limit)) });
});

// GET /api/summary — national summary stats
app.get('/api/summary', (req, res) => {
  const avgCrime = parseFloat((STATE_DATA.reduce((a, s) => a + s.rates[2], 0) / STATE_DATA.length).toFixed(2));
  const avgLiteracy = parseFloat((STATE_DATA.reduce((a, s) => a + s.literacy, 0) / STATE_DATA.length).toFixed(1));
  const totalPop = STATE_DATA.reduce((a, s) => a + s.pop, 0);
  const avgAQI = parseFloat((CITY_AQI.reduce((a, c) => a + c.aqi, 0) / CITY_AQI.length).toFixed(1));
  const totalCrimes = STATE_DATA.reduce((a, s) => a + s.crimes[2], 0);

  res.json({
    success: true,
    data: {
      avgCrime, avgLiteracy, totalPop,
      avgAQI, totalCrimes,
      stateCount: STATE_DATA.length,
      cityCount: CITY_AQI.length,
    }
  });
});

// GET /api/search?q=delhi — search states
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json({ success: true, data: [] });
  const results = STATE_DATA
    .filter(s => s.state.toLowerCase().includes(q))
    .slice(0, 5)
    .map(s => ({ state: s.state, coords: STATE_COORDS[s.state] }));
  res.json({ success: true, data: results });
});

app.listen(PORT, () => {
  console.log(`\n🚀 CityLens API running at http://localhost:${PORT}`);
  console.log(`📊 Endpoints:`);
  console.log(`   GET /api/states`);
  console.log(`   GET /api/states/:name`);
  console.log(`   GET /api/cities?state=Bihar`);
  console.log(`   GET /api/ranking?indicator=crime`);
  console.log(`   GET /api/summary`);
  console.log(`   GET /api/search?q=delhi\n`);
});
