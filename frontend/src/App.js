import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── HELPERS ───────────────────────────────────────────────────────────────────
const fmt = n => n>=1e7?(n/1e7).toFixed(1)+'Cr':n>=1e5?(n/1e5).toFixed(1)+'L':n>=1e3?(n/1e3).toFixed(1)+'K':String(n);

const getAQIColor = aqi => {
  if(aqi<=50)  return '#00c964';
  if(aqi<=100) return '#a3c940';
  if(aqi<=150) return '#f5a623';
  if(aqi<=200) return '#e84c1e';
  if(aqi<=300) return '#b40032';
  return '#7b0031';
};

const getAQILabel = aqi => {
  if(aqi<=50)  return 'Good';
  if(aqi<=100) return 'Moderate';
  if(aqi<=150) return 'Unhealthy (Sensitive)';
  if(aqi<=200) return 'Unhealthy';
  if(aqi<=300) return 'Very Unhealthy';
  return 'Severe';
};

const getMarkerColor = (val, min, max, indicator) => {
  if(val===null||val===undefined) return 'rgba(100,116,139,0.6)';
  const r = Math.min(1,Math.max(0,(val-min)/(max-min||1)));
  if(indicator==='literacy') {
    const g = Math.round(80+(200-80)*r), b2 = Math.round(40+(100-40)*r);
    return `rgba(20,${g},${b2},0.85)`;
  }
  if(indicator==='population') {
    const alpha = 0.35 + 0.65 * r;
    return `rgba(79,142,247,${alpha.toFixed(2)})`;
  }
  const red = Math.round(20+(232-20)*r), g2 = Math.round(80+(30-80)*r);
  return `rgba(${red},${g2},30,0.85)`;
};

const getGrade = (state) => {
  let score = 0;
  const crimeScore = state.rates[2] < 20 ? 4 : state.rates[2] < 35 ? 3 : state.rates[2] < 55 ? 2 : 1;
  const litScore   = state.literacy > 85 ? 4 : state.literacy > 75 ? 3 : state.literacy > 65 ? 2 : 1;
  const aqiScore   = !state.avgAQI ? 2 : state.avgAQI < 60 ? 4 : state.avgAQI < 100 ? 3 : state.avgAQI < 150 ? 2 : 1;
  score = crimeScore + litScore + aqiScore;
  if(score >= 11) return {grade:'A', color:'#00c964', label:'Excellent'};
  if(score >= 9)  return {grade:'B', color:'#a3c940', label:'Good'};
  if(score >= 7)  return {grade:'C', color:'#f5a623', label:'Average'};
  if(score >= 5)  return {grade:'D', color:'#e84c1e', label:'Below Avg'};
  return {grade:'F', color:'#b40032', label:'Poor'};
};

const INDICATORS = [
  {key:'crime',     label:'Crime Rate', icon:'🔴', color:'#e84c1e'},
  {key:'aqi',       label:'Avg AQI',    icon:'🌫️', color:'#f5a623'},
  {key:'literacy',  label:'Literacy',   icon:'📚', color:'#00c9a7'},
  {key:'population',label:'Population', icon:'👥', color:'#4f8ef7'},
];

// ── SPARKLINE ─────────────────────────────────────────────────────────────────
function Sparkline({data, color='#e84c1e', width=100, height=28}) {
  if(!data||data.length<2) return null;
  const min=Math.min(...data), max=Math.max(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-min)/range)*(height-4)-2}`).join(' ');
  return (
    <svg width={width} height={height} style={{display:'block',overflow:'visible'}}>
      <defs>
        <linearGradient id={`sg${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#sg${color.replace('#','')})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"
        style={{strokeDasharray:300,strokeDashoffset:300,animation:'drawLine 1.2s ease forwards'}}/>
    </svg>
  );
}

// ── KPI CARD ──────────────────────────────────────────────────────────────────
function KPICard({label, value, unit, color, sparkData, change}) {
  const isUp = change > 0;
  return (
    <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'1rem',transition:'border-color 0.2s'}}
      onMouseEnter={e=>e.currentTarget.style.borderColor=color}
      onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.4rem'}}>
        <div style={{fontSize:'0.65rem',color:'var(--muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px'}}>{label}</div>
        {change!==undefined&&(
          <div style={{fontSize:'0.68rem',fontWeight:700,color:isUp?'var(--accent)':'var(--teal)',display:'flex',alignItems:'center',gap:'0.15rem'}}>
            <span style={{fontSize:'0.55rem'}}>{isUp?'△':'▽'}</span>{Math.abs(change).toFixed(1)}%
          </div>
        )}
      </div>
      <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.4rem',color,lineHeight:1,marginBottom:'0.4rem'}}>
        {value}{unit&&<span style={{fontSize:'0.7rem',color:'var(--muted)',marginLeft:3}}>{unit}</span>}
      </div>
      {sparkData&&<Sparkline data={sparkData} color={color} width={120} height={24}/>}
    </div>
  );
}

// ── TABLEAU MODAL ─────────────────────────────────────────────────────────────
function TableauModal({onClose}) {
  const ref = useRef(null);
  useEffect(()=>{
    if(!ref.current) return;
    ref.current.innerHTML='';
    const ph=document.createElement('div');
    ph.style.position='relative';
    const obj=document.createElement('object');
    obj.className='tableauViz';
    obj.style.cssText='width:1366px;height:1327px;display:block;';
    [['host_url','https%3A%2F%2Fpublic.tableau.com%2F'],['embed_code_version','3'],
     ['site_root',''],['name','citylens_1/CityLensDashboard'],['tabs','no'],
     ['toolbar','yes'],['animate_transition','yes'],['display_static_image','yes'],
     ['display_spinner','yes'],['display_overlay','yes'],['display_count','yes'],
     ['language','en-GB'],['filter','publish=yes']
    ].forEach(([n,v])=>{const p=document.createElement('param');p.name=n;p.value=v;obj.appendChild(p);});
    ph.appendChild(obj);
    ref.current.appendChild(ph);
    const s=document.createElement('script');
    s.src='https://public.tableau.com/javascripts/api/viz_v1.js';
    ph.insertBefore(s,obj);
  },[]);
  return (
    <div style={{position:'fixed',inset:0,zIndex:99999,display:'flex',flexDirection:'column',background:'rgba(5,7,12,0.97)',animation:'fadeIn 0.25s ease'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0.75rem 1.5rem',borderBottom:'1px solid var(--border)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:'var(--accent)',animation:'blink 2s infinite'}}/>
          <span style={{fontFamily:'Syne,sans-serif',fontWeight:700,fontSize:'0.95rem'}}>CityLens — Tableau Dashboard</span>
          <span style={{fontSize:'0.72rem',color:'var(--muted)',background:'var(--surface)',border:'1px solid var(--border)',padding:'0.2rem 0.6rem',borderRadius:6}}>Interactive • Click states to filter</span>
        </div>
        <button onClick={onClose} style={{width:32,height:32,borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',color:'var(--muted2)',fontSize:'1rem',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s'}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--muted2)';}}>✕</button>
      </div>
      <div style={{flex:1,overflow:'auto',background:'#fff'}}><div ref={ref}/></div>
      <div style={{display:'flex',gap:'1.5rem',padding:'0.6rem 1.5rem',borderTop:'1px solid var(--border)',flexShrink:0,flexWrap:'wrap'}}>
        {[['🖱️','Click a state on the map to filter all charts'],['🔄','Use dropdown to switch indicators'],['↩️','Click empty space to reset'],['📜','Scroll inside for more charts']].map(([icon,text])=>(
          <div key={text} style={{display:'flex',alignItems:'center',gap:'0.4rem',fontSize:'0.72rem',color:'var(--muted)'}}><span>{icon}</span><span>{text}</span></div>
        ))}
      </div>
    </div>
  );
}

// ── SCATTER PLOT ──────────────────────────────────────────────────────────────
function ScatterPlot({states}) {
  const filtered = states.filter(s => s.rates[2] < 200);
  const W=480, H=260, PL=48, PR=20, PT=16, PB=40;
  const xs=filtered.map(s=>s.literacy), ys=filtered.map(s=>s.rates[2]);
  const xmin=Math.min(...xs)-2, xmax=Math.max(...xs)+2;
  const ymin=0, ymax=Math.max(...ys)+5;
  const toX=v=>PL+(v-xmin)/(xmax-xmin)*(W-PL-PR);
  const toY=v=>PT+(1-(v-ymin)/(ymax-ymin))*(H-PT-PB);
  const [hov,setHov]=useState(null);

  // simple linear regression
  const n=filtered.length, sx=xs.reduce((a,b)=>a+b,0), sy=ys.reduce((a,b)=>a+b,0);
  const sxy=filtered.reduce((a,s)=>a+s.literacy*s.rates[2],0);
  const sx2=xs.reduce((a,b)=>a+b*b,0);
  const slope=(n*sxy-sx*sy)/(n*sx2-sx*sx);
  const intercept=(sy-slope*sx)/n;
  const x1=xmin, y1=slope*x1+intercept, x2=xmax, y2=slope*x2+intercept;

  return (
    <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'1.25rem'}}>
      <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:'0.25rem'}}>Crime Rate vs Literacy Rate</div>
      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginBottom:'0.75rem'}}>Each dot = one state • Trend line shows negative correlation</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:'visible'}}>
        {/* Grid lines */}
        {[20,40,60,80].map(v=>(
          <line key={v} x1={PL} x2={W-PR} y1={toY(v)} y2={toY(v)} stroke="var(--border)" strokeWidth="1"/>
        ))}
        {/* Trend line */}
        <line x1={toX(x1)} y1={toY(y1)} x2={toX(x2)} y2={toY(y2)} stroke="#4f8ef7" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.6"/>
        {/* Dots */}
        {filtered.map((s,i)=>(
          <circle key={s.state} cx={toX(s.literacy)} cy={toY(s.rates[2])} r={hov===i?7:5}
            fill={s.rates[2]>60?'#e84c1e':s.rates[2]>35?'#f5a623':'#00c9a7'}
            stroke={hov===i?'#fff':'transparent'} strokeWidth="1.5"
            style={{cursor:'pointer',transition:'r 0.15s'}}
            onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
            opacity="0.85"/>
        ))}
        {/* Tooltip */}
        {hov!==null&&(()=>{
          const s=filtered[hov];
          const cx=toX(s.literacy), cy=toY(s.rates[2]);
          const tx=cx>W-140?cx-130:cx+10, ty=cy<40?cy+10:cy-42;
          return (
            <g>
              <rect x={tx} y={ty} width={120} height={36} rx="6" fill="rgba(12,15,24,0.97)" stroke="var(--border2)"/>
              <text x={tx+8} y={ty+14} fontSize="9" fill="white" fontWeight="700">{s.state}</text>
              <text x={tx+8} y={ty+26} fontSize="8" fill="var(--muted2)">Literacy: {s.literacy}% | Crime: {s.rates[2]}</text>
            </g>
          );
        })()}
        {/* Axes */}
        <line x1={PL} y1={PT} x2={PL} y2={H-PB} stroke="var(--border2)" strokeWidth="1"/>
        <line x1={PL} y1={H-PB} x2={W-PR} y2={H-PB} stroke="var(--border2)" strokeWidth="1"/>
        {/* Y labels */}
        {[0,20,40,60,80].map(v=>(
          <text key={v} x={PL-6} y={toY(v)+3} fontSize="8" fill="var(--muted)" textAnchor="end">{v}</text>
        ))}
        {/* X labels */}
        {[60,70,80,90].map(v=>(
          <text key={v} x={toX(v)} y={H-PB+12} fontSize="8" fill="var(--muted)" textAnchor="middle">{v}%</text>
        ))}
        <text x={W/2} y={H-2} fontSize="8" fill="var(--muted)" textAnchor="middle">Literacy Rate (%)</text>
        <text x={10} y={H/2} fontSize="8" fill="var(--muted)" textAnchor="middle" transform={`rotate(-90,10,${H/2})`}>Crime Rate / Lakh</text>
      </svg>
      <div style={{display:'flex',gap:'1rem',marginTop:'0.5rem',flexWrap:'wrap'}}>
        {[['#00c964','Low Crime (<35)'],['#f5a623','Medium Crime (35-60)'],['#e84c1e','High Crime (>60)']].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:'0.3rem',fontSize:'0.68rem',color:'var(--muted)'}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:c}}/>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── REPORT CARD ───────────────────────────────────────────────────────────────
function ReportCards({states}) {
  const [sort,setSort]=useState('grade');
  const graded = states.filter(s=>s.rates[2]<200).map(s=>({...s,gradeInfo:getGrade(s)}));
  const sorted = [...graded].sort((a,b)=>{
    if(sort==='grade') return b.gradeInfo.grade.localeCompare(a.gradeInfo.grade)?-1:1;
    if(sort==='crime') return a.rates[2]-b.rates[2];
    if(sort==='literacy') return b.literacy-a.literacy;
    return 0;
  });
  return (
    <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'1.25rem'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.75rem',flexWrap:'wrap',gap:'0.5rem'}}>
        <div>
          <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px'}}>State Report Cards</div>
          <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>Graded A–F based on Crime, Literacy & AQI</div>
        </div>
        <div style={{display:'flex',gap:'0.3rem'}}>
          {['grade','crime','literacy'].map(s=>(
            <button key={s} onClick={()=>setSort(s)} style={{padding:'0.25rem 0.6rem',borderRadius:6,border:'1px solid var(--border)',
              background:sort===s?'var(--accent)':'var(--surface)',color:sort===s?'#fff':'var(--muted)',
              fontSize:'0.68rem',cursor:'pointer',fontFamily:'DM Sans,sans-serif',textTransform:'capitalize'}}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:'0.5rem',maxHeight:320,overflowY:'auto'}}>
        {sorted.map(s=>(
          <div key={s.state} style={{background:'var(--surface)',border:`1px solid ${s.gradeInfo.color}30`,borderRadius:10,padding:'0.75rem',
            transition:'transform 0.15s,border-color 0.15s',cursor:'default'}}
            onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.borderColor=s.gradeInfo.color;}}
            onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.borderColor=`${s.gradeInfo.color}30`;}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.4rem'}}>
              <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.6rem',color:s.gradeInfo.color,lineHeight:1}}>{s.gradeInfo.grade}</div>
              <div style={{fontSize:'0.6rem',fontWeight:600,color:s.gradeInfo.color,background:`${s.gradeInfo.color}18`,
                padding:'0.15rem 0.4rem',borderRadius:4}}>{s.gradeInfo.label}</div>
            </div>
            <div style={{fontSize:'0.72rem',fontWeight:600,marginBottom:'0.3rem',lineHeight:1.2}}>{s.state}</div>
            <div style={{fontSize:'0.62rem',color:'var(--muted)'}}>Crime: {s.rates[2]} | Lit: {s.literacy}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SAFE CITY FINDER ──────────────────────────────────────────────────────────
function SafeCityFinder({states}) {
  const [maxCrime,setMaxCrime]=useState(60);
  const [minLit,setMinLit]=useState(65);
  const [maxAQI,setMaxAQI]=useState(175);
  const [preset,setPreset]=useState(null);

  // Only include states with real AQI data, no outliers (Manipur 2023 spike)
  const validStates = states.filter(s => s.avgAQI && s.rates[2] < 200);

  // Presets
  const PRESETS = [
    {label:'🏆 Best Overall', maxCrime:35, minLit:75, maxAQI:130, color:'#00c9a7'},
    {label:'🌿 Clean Air',    maxCrime:80, minLit:60, maxAQI:100, color:'#a3c940'},
    {label:'📚 High Literacy',maxCrime:80, minLit:82, maxAQI:175, color:'#4f8ef7'},
    {label:'🔒 Low Crime',    maxCrime:25, minLit:60, maxAQI:175, color:'#e84c1e'},
  ];

  const applyPreset = (p) => {
    setMaxCrime(p.maxCrime);
    setMinLit(p.minLit);
    setMaxAQI(p.maxAQI);
    setPreset(p.label);
  };

  const results = validStates.filter(s =>
    s.rates[2] <= maxCrime &&
    s.literacy >= minLit &&
    s.avgAQI <= maxAQI
  ).sort((a,b) => {
    // Sort by overall score — lower crime, higher literacy, lower AQI
    const scoreA = (100-a.rates[2]) + a.literacy + (200-a.avgAQI);
    const scoreB = (100-b.rates[2]) + b.literacy + (200-b.avgAQI);
    return scoreB - scoreA;
  });

  const reset = () => { setMaxCrime(60); setMinLit(65); setMaxAQI(175); setPreset(null); };

  return (
    <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'1.25rem'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.25rem'}}>
        <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px'}}>Safe State Finder</div>
        <button onClick={reset} style={{fontSize:'0.68rem',color:'var(--muted)',background:'none',border:'1px solid var(--border)',
          borderRadius:6,padding:'0.2rem 0.5rem',cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Reset</button>
      </div>
      <div style={{fontSize:'0.7rem',color:'var(--muted)',marginBottom:'0.9rem'}}>
        Only showing states with available AQI data ({validStates.length} states)
      </div>

      {/* Quick Presets */}
      <div style={{marginBottom:'1rem'}}>
        <div style={{fontSize:'0.65rem',color:'var(--muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:'0.4rem'}}>Quick Presets</div>
        <div style={{display:'flex',gap:'0.4rem',flexWrap:'wrap'}}>
          {PRESETS.map(p=>(
            <button key={p.label} onClick={()=>applyPreset(p)} style={{
              padding:'0.35rem 0.7rem',borderRadius:8,border:`1px solid ${preset===p.label?p.color:'var(--border)'}`,
              background:preset===p.label?`${p.color}18`:'var(--surface)',
              color:preset===p.label?p.color:'var(--muted2)',
              fontSize:'0.72rem',fontWeight:preset===p.label?700:400,
              cursor:'pointer',fontFamily:'DM Sans,sans-serif',transition:'all 0.15s',
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <div style={{display:'flex',flexDirection:'column',gap:'0.85rem',marginBottom:'1rem'}}>
        {[
          {label:'Max Crime Rate',desc:`Below ${maxCrime} per lakh`,val:maxCrime,set:setMaxCrime,min:5,max:120,step:5,unit:'/lakh',color:'var(--accent)'},
          {label:'Min Literacy Rate',desc:`At least ${minLit}%`,val:minLit,set:setMinLit,min:50,max:95,step:1,unit:'%',color:'var(--teal)'},
          {label:'Max AQI',desc:getAQILabel(maxAQI),val:maxAQI,set:setMaxAQI,min:50,max:250,step:10,unit:'',color:getAQIColor(maxAQI)},
        ].map(sl=>(
          <div key={sl.label}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.3rem',alignItems:'center'}}>
              <div>
                <span style={{fontSize:'0.72rem',color:'var(--text)',fontWeight:600}}>{sl.label}</span>
                <span style={{fontSize:'0.65rem',color:'var(--muted)',marginLeft:'0.4rem'}}>{sl.desc}</span>
              </div>
              <span style={{fontSize:'0.78rem',fontWeight:700,color:sl.color,
                background:`${sl.color}15`,padding:'0.15rem 0.5rem',borderRadius:5}}>
                {sl.val}{sl.unit}
              </span>
            </div>
            <input type="range" min={sl.min} max={sl.max} step={sl.step} value={sl.val}
              onChange={e=>{sl.set(Number(e.target.value));setPreset(null);}}
              style={{width:'100%',accentColor:sl.color,cursor:'pointer',height:4}}/>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.6rem',color:'var(--muted)',marginTop:'0.15rem'}}>
              <span>{sl.min}{sl.unit}</span><span>{sl.max}{sl.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Results header */}
      <div style={{borderTop:'1px solid var(--border)',paddingTop:'0.75rem'}}>
        <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.75rem'}}>
          <div style={{
            fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.8rem',
            color:results.length>0?'var(--teal)':'var(--accent)',lineHeight:1
          }}>{results.length}</div>
          <div>
            <div style={{fontSize:'0.78rem',fontWeight:600,color:'var(--text)'}}>
              {results.length===0?'No matching states':'States match your criteria'}
            </div>
            <div style={{fontSize:'0.68rem',color:'var(--muted)'}}>
              Sorted by best overall score
            </div>
          </div>
          {results.length>0&&(
            <div style={{marginLeft:'auto',fontSize:'0.68rem',color:'var(--muted)',
              background:'var(--surface)',border:'1px solid var(--border)',borderRadius:6,padding:'0.2rem 0.5rem'}}>
              #{1} best: {results[0].state.split(' ')[0]}
            </div>
          )}
        </div>

        {results.length===0?(
          <div style={{background:'rgba(232,76,30,0.06)',border:'1px dashed rgba(232,76,30,0.3)',borderRadius:10,padding:'1rem',textAlign:'center'}}>
            <div style={{fontSize:'1.5rem',marginBottom:'0.4rem'}}>🔍</div>
            <div style={{fontSize:'0.8rem',color:'var(--muted2)',fontWeight:600,marginBottom:'0.25rem'}}>No states found</div>
            <div style={{fontSize:'0.72rem',color:'var(--muted)'}}>Try a preset or relax your sliders</div>
          </div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',maxHeight:320,overflowY:'auto'}}>
            {results.map((s,i)=>{
              const g=getGrade(s);
              const isTop=i===0;
              return (
                <div key={s.state} style={{
                  background:isTop?`${g.color}0d`:'var(--surface)',
                  border:`1px solid ${isTop?g.color+'50':'var(--border)'}`,
                  borderRadius:10,padding:'0.75rem 0.9rem',
                  position:'relative',
                }}>
                  {/* Top row — rank, name, grade badge */}
                  <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.5rem'}}>
                    <span style={{fontSize:'0.65rem',color:'var(--muted)',flexShrink:0}}>#{i+1}</span>
                    <span style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'0.95rem',color:'var(--text)',flex:1}}>{s.state}</span>
                    <span style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1rem',color:g.color,
                      background:`${g.color}18`,border:`1px solid ${g.color}30`,
                      borderRadius:6,padding:'0.1rem 0.5rem',flexShrink:0}}>{g.grade}</span>
                    {isTop&&<span style={{background:g.color,fontSize:'0.55rem',fontWeight:700,
                      color:'#fff',padding:'0.15rem 0.5rem',borderRadius:5,flexShrink:0}}>BEST</span>}
                  </div>
                  {/* Stat bars */}
                  <div style={{display:'flex',flexDirection:'column',gap:'0.25rem'}}>
                    {[
                      {label:'Crime',val:s.rates[2],max:120,color:'var(--accent)',display:s.rates[2]+'/L',lowerBetter:true},
                      {label:'Literacy',val:s.literacy,max:100,color:'var(--teal)',display:s.literacy+'%',lowerBetter:false},
                      {label:'AQI',val:s.avgAQI,max:200,color:getAQIColor(s.avgAQI),display:s.avgAQI+' — '+getAQILabel(s.avgAQI),lowerBetter:true},
                    ].map(bar=>{
                      const pct=bar.lowerBetter?(1-Math.min(bar.val/bar.max,1))*100:Math.min(bar.val/bar.max,1)*100;
                      return (
                        <div key={bar.label} style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
                          <span style={{fontSize:'0.6rem',color:'var(--muted)',width:42,flexShrink:0}}>{bar.label}</span>
                          <div style={{flex:1,height:4,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:pct+'%',background:bar.color,borderRadius:2,transition:'width 0.5s ease'}}/>
                          </div>
                          <span style={{fontSize:'0.62rem',color:bar.color,fontWeight:600,minWidth:80,textAlign:'right'}}>{bar.display}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── DEEP DIVE FULLSCREEN ──────────────────────────────────────────────────────
function DeepDiveModal({data, cities, states, onClose}) {
  const [tab,setTab]=useState('overview');
  if(!data) return null;
  const maxRate=Math.max(...data.rates);
  const isUp=data.crimeChange>0;
  const gradeInfo=getGrade(data);

  const tabs=[
    {id:'overview', label:'📋 Overview'},
    {id:'scatter',  label:'📈 Crime vs Literacy'},
    {id:'grades',   label:'🏆 Report Cards'},
    {id:'finder',   label:'🔍 Safe State Finder'},
  ];

  return (
    <div style={{position:'fixed',inset:0,zIndex:9000,background:'var(--bg)',display:'flex',flexDirection:'column',animation:'fadeIn 0.2s ease'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0.75rem 1.5rem',
        borderBottom:'1px solid var(--border)',flexShrink:0,background:'var(--surface)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'1rem'}}>
          <div>
            <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.1rem'}}>
              🔍 Deep Dive — <span style={{color:'var(--accent)'}}>{data.state}</span>
            </div>
            <div style={{fontSize:'0.68rem',color:'var(--muted)'}}>Full analytics view</div>
          </div>
          <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'2rem',color:gradeInfo.color,
            background:`${gradeInfo.color}15`,border:`1px solid ${gradeInfo.color}30`,
            borderRadius:10,width:52,height:52,display:'flex',alignItems:'center',justifyContent:'center'}}>
            {gradeInfo.grade}
          </div>
        </div>
        <button onClick={onClose} style={{padding:'0.4rem 1rem',borderRadius:8,border:'1px solid var(--border)',
          background:'var(--card)',color:'var(--muted2)',fontSize:'0.8rem',cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>
          ✕ Close
        </button>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'0.25rem',padding:'0.6rem 1.5rem',borderBottom:'1px solid var(--border)',flexShrink:0,background:'var(--surface)'}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:'0.4rem 1rem',borderRadius:8,border:'none',cursor:'pointer',fontFamily:'DM Sans,sans-serif',
            fontSize:'0.8rem',fontWeight:tab===t.id?600:400,transition:'all 0.15s',
            background:tab===t.id?'var(--accent)':'var(--card)',
            color:tab===t.id?'#fff':'var(--muted)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:'auto',padding:'1.5rem'}}>

        {/* OVERVIEW TAB */}
        {tab==='overview'&&(
          <div style={{display:'flex',flexDirection:'column',gap:'1rem',maxWidth:900,margin:'0 auto'}}>
            {/* Crime change banner */}
            <div style={{background:isUp?'rgba(232,76,30,0.08)':'rgba(0,201,167,0.08)',
              border:`1px solid ${isUp?'rgba(232,76,30,0.25)':'rgba(0,201,167,0.25)'}`,
              borderRadius:12,padding:'0.9rem 1.2rem',display:'flex',alignItems:'center',gap:'0.6rem',
              fontSize:'0.85rem',fontWeight:600,color:isUp?'var(--accent)':'var(--teal)'}}>
              <span style={{fontSize:'1.1rem'}}>{isUp?'📈':'📉'}</span>
              Crime {isUp?'increased':'decreased'} by {Math.abs(data.crimeChange)}% from 2021 to 2023 •
              <span style={{color:'var(--muted2)',fontWeight:400}}>Grade: <strong style={{color:gradeInfo.color}}>{gradeInfo.grade} — {gradeInfo.label}</strong></span>
            </div>

            {/* KPI grid */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'0.75rem'}}>
              {[
                {label:'Crime Rate 2023',val:data.rates[2],unit:'/lakh',color:'var(--accent)',spark:data.rates},
                {label:'Crime Rate 2021',val:data.rates[0],unit:'/lakh',color:'var(--muted2)'},
                {label:'Literacy Rate',val:data.literacy+'%',color:'var(--teal)'},
                {label:'Avg AQI',val:data.avgAQI||'N/A',color:'var(--accent2)'},
                {label:'Population',val:fmt(data.pop),color:'var(--blue)'},
                {label:'Crimes 2023',val:data.crimes[2].toLocaleString(),color:'var(--purple)'},
              ].map(k=>(
                <div key={k.label} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'1rem'}}>
                  <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'0.35rem'}}>{k.label}</div>
                  <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.3rem',color:k.color}}>
                    {k.val}{k.unit&&<span style={{fontSize:'0.7rem',color:'var(--muted)',marginLeft:2}}>{k.unit}</span>}
                  </div>
                  {k.spark&&<Sparkline data={k.spark} color={k.color} width={120} height={22}/>}
                </div>
              ))}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
              {/* Crime trend bars */}
              <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'1.25rem'}}>
                <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:'1rem'}}>Crime Rate Trend</div>
                {['2021','2022','2023'].map((yr,i)=>(
                  <div key={yr} style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.75rem'}}>
                    <span style={{fontSize:'0.72rem',color:'var(--muted)',width:32}}>{yr}</span>
                    <div style={{flex:1,height:8,background:'var(--border)',borderRadius:4,overflow:'hidden'}}>
                      <div style={{height:'100%',borderRadius:4,transition:'width 0.8s ease',
                        width:(data.rates[i]/maxRate*100)+'%',
                        background:i===2?'linear-gradient(90deg,var(--accent),var(--accent2))':'var(--border2)'}}/>
                    </div>
                    <span style={{fontSize:'0.78rem',fontWeight:700,color:i===2?'var(--accent)':'var(--muted2)',width:40,textAlign:'right'}}>{data.rates[i]}</span>
                  </div>
                ))}
              </div>

              {/* Cities AQI */}
              <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'1.25rem'}}>
                <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:'1rem'}}>Cities by AQI</div>
                {cities.length===0?(
                  <div style={{fontSize:'0.78rem',color:'var(--muted)',textAlign:'center',paddingTop:'1rem'}}>No city AQI data available</div>
                ):cities.slice(0,8).map((c,i)=>(
                  <div key={c.city} style={{display:'flex',alignItems:'center',gap:'0.6rem',marginBottom:'0.5rem'}}>
                    <span style={{fontSize:'0.65rem',color:'var(--muted)',width:14}}>{i+1}</span>
                    <span style={{fontSize:'0.78rem',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.city}</span>
                    <div style={{width:60,height:4,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
                      <div style={{height:'100%',borderRadius:2,width:(c.aqi/cities[0].aqi*100)+'%',background:getAQIColor(c.aqi)}}/>
                    </div>
                    <span style={{fontSize:'0.75rem',fontWeight:700,color:getAQIColor(c.aqi),minWidth:36,textAlign:'right'}}>{c.aqi}</span>
                    <span style={{fontSize:'0.62rem',color:'var(--muted)',width:36}}>{c.pollutant}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SCATTER TAB */}
        {tab==='scatter'&&(
          <div style={{maxWidth:700,margin:'0 auto'}}>
            <ScatterPlot states={states}/>
            <div style={{marginTop:'1rem',background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'1rem'}}>
              <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',marginBottom:'0.4rem'}}>What This Shows</div>
              <div style={{fontSize:'0.78rem',color:'var(--muted)',lineHeight:1.7}}>
                The blue dashed trend line shows a <strong style={{color:'var(--teal)'}}>negative correlation</strong> — as literacy increases, crime rate tends to decrease.
                States like Kerala (93.7% literacy, 30.7 crime) support this. However Delhi (86.5% literacy, 65.9 crime) shows
                that urbanization can override this effect. Hover over any dot to see the state.
              </div>
            </div>
          </div>
        )}

        {/* GRADES TAB */}
        {tab==='grades'&&(
          <div style={{maxWidth:900,margin:'0 auto'}}>
            <ReportCards states={states}/>
            <div style={{marginTop:'1rem',background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'1rem'}}>
              <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',marginBottom:'0.4rem'}}>How Grades Are Calculated</div>
              <div style={{fontSize:'0.78rem',color:'var(--muted)',lineHeight:1.7}}>
                Each state is scored across 3 indicators — Crime Rate, Literacy Rate and AQI. Each indicator gives 1–4 points.
                Total score of 11–12 = A, 9–10 = B, 7–8 = C, 5–6 = D, below 5 = F. Sort by Grade, Crime or Literacy using the buttons above.
              </div>
            </div>
          </div>
        )}

        {/* FINDER TAB */}
        {tab==='finder'&&(
          <div style={{maxWidth:900,margin:'0 auto'}}>
            <SafeCityFinder states={states}/>
            <div style={{marginTop:'1rem',background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'1rem'}}>
              <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--muted2)',marginBottom:'0.4rem'}}>How To Use</div>
              <div style={{fontSize:'0.78rem',color:'var(--muted)',lineHeight:1.7}}>
                Drag the sliders to set your preferred thresholds. The finder instantly shows all states that meet every condition simultaneously.
                Results are sorted by lowest crime rate first. Each result shows the state's report card grade.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SIDEBAR DEEP DIVE PANEL ───────────────────────────────────────────────────
function SidebarDeepDive({data, cities, onClose}) {
  if(!data) return null;
  const maxRate=Math.max(...data.rates);
  const isUp=data.crimeChange>0;
  return (
    <div style={{position:'absolute',inset:0,zIndex:500,background:'var(--surface)',overflowY:'auto',animation:'slideLeft 0.3s ease'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'1rem 1.25rem',
        borderBottom:'1px solid var(--border)',position:'sticky',top:0,background:'var(--surface)',zIndex:10}}>
        <div>
          <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.1rem'}}>{data.state}</div>
          <div style={{fontSize:'0.7rem',color:'var(--muted)'}}>State Overview</div>
        </div>
        <button onClick={onClose} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,
          color:'var(--muted2)',padding:'0.35rem 0.75rem',cursor:'pointer',fontSize:'0.78rem',fontFamily:'DM Sans,sans-serif'}}>← Back</button>
      </div>
      <div style={{padding:'1rem'}}>
        <div style={{background:isUp?'rgba(232,76,30,0.1)':'rgba(0,201,167,0.1)',
          border:`1px solid ${isUp?'rgba(232,76,30,0.25)':'rgba(0,201,167,0.25)'}`,
          borderRadius:10,padding:'0.6rem 0.9rem',marginBottom:'1rem',
          display:'flex',alignItems:'center',gap:'0.4rem',
          fontSize:'0.78rem',fontWeight:600,color:isUp?'var(--accent)':'var(--teal)'}}>
          <span>{isUp?'△':'▽'}</span>Crime {isUp?'increased':'decreased'} {Math.abs(data.crimeChange)}% (2021→2023)
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',marginBottom:'1rem'}}>
          {[
            {label:'Crime Rate 2023',val:data.rates[2],unit:'/lakh',color:'var(--accent)',spark:data.rates},
            {label:'Literacy Rate',val:data.literacy+'%',color:'var(--teal)'},
            {label:'Population',val:fmt(data.pop),color:'var(--blue)'},
            {label:'Avg AQI',val:data.avgAQI||'N/A',color:'var(--accent2)'},
          ].map(k=>(
            <div key={k.label} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:10,padding:'0.75rem'}}>
              <div style={{fontSize:'0.62rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'0.25rem'}}>{k.label}</div>
              <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.1rem',color:k.color}}>
                {k.val}{k.unit&&<span style={{fontSize:'0.65rem',color:'var(--muted)',marginLeft:2}}>{k.unit}</span>}
              </div>
              {k.spark&&<Sparkline data={k.spark} color={k.color} width={100} height={20}/>}
            </div>
          ))}
        </div>
        <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'1rem',marginBottom:'1rem'}}>
          <div style={{fontSize:'0.68rem',color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px',fontWeight:600,marginBottom:'0.75rem'}}>Crime Rate Trend</div>
          {['2021','2022','2023'].map((yr,i)=>(
            <div key={yr} style={{display:'flex',alignItems:'center',gap:'0.6rem',marginBottom:'0.5rem'}}>
              <span style={{fontSize:'0.7rem',color:'var(--muted)',width:30}}>{yr}</span>
              <div style={{flex:1,height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:3,transition:'width 0.8s ease',width:(data.rates[i]/maxRate*100)+'%',
                  background:i===2?'linear-gradient(90deg,var(--accent),var(--accent2))':'var(--border2)'}}/>
              </div>
              <span style={{fontSize:'0.75rem',fontWeight:700,color:i===2?'var(--accent)':'var(--muted2)',width:40,textAlign:'right'}}>{data.rates[i]}</span>
            </div>
          ))}
        </div>
        {cities.length>0&&(
          <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'1rem'}}>
            <div style={{fontSize:'0.68rem',color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px',fontWeight:600,marginBottom:'0.75rem'}}>Cities by AQI</div>
            {cities.slice(0,8).map((c,i)=>(
              <div key={c.city} style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.4rem'}}>
                <span style={{fontSize:'0.65rem',color:'var(--muted)',width:14}}>{i+1}</span>
                <span style={{fontSize:'0.78rem',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.city}</span>
                <div style={{width:60,height:4,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:2,width:(c.aqi/cities[0].aqi*100)+'%',background:getAQIColor(c.aqi)}}/>
                </div>
                <span style={{fontSize:'0.75rem',fontWeight:700,color:getAQIColor(c.aqi),width:36,textAlign:'right'}}>{c.aqi}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [states,setStates]             = useState([]);
  const [summary,setSummary]           = useState(null);
  const [selected,setSelected]         = useState(null);
  const [sidebarDeepDive,setSidebarDeepDive] = useState(null);
  const [deepDiveModal,setDeepDiveModal]     = useState(false);
  const [indicator,setIndicator]       = useState('crime');
  const [loading,setLoading]           = useState(true);
  const [showTableau,setShowTableau]   = useState(false);
  const [searchQ,setSearchQ]           = useState('');
  const [searchRes,setSearchRes]       = useState([]);
  const mapRef     = useRef(null);
  const leafletRef = useRef(null);
  const markersRef = useRef([]);
  const API = 'http://localhost:5000/api';

  useEffect(()=>{
    Promise.all([
      fetch(`${API}/states`).then(r=>r.json()),
      fetch(`${API}/summary`).then(r=>r.json()),
    ]).then(([sd,sum])=>{
      setStates(sd.data||[]);
      setSummary(sum.data||null);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);

  useEffect(()=>{
    if(!searchQ.trim()){setSearchRes([]);return;}
    const t=setTimeout(()=>{
      fetch(`${API}/search?q=${searchQ}`).then(r=>r.json()).then(d=>setSearchRes(d.data||[]));
    },300);
    return ()=>clearTimeout(t);
  },[searchQ]);

  const selectState = useCallback(async(stateName)=>{
    if(selected?.state===stateName){setSelected(null);setSidebarDeepDive(null);return;}
    const res=await fetch(`${API}/states/${encodeURIComponent(stateName)}`);
    const json=await res.json();
    if(json.success){
      setSelected(json.data);
      setSidebarDeepDive(null);
      if(leafletRef.current&&json.data.coords) leafletRef.current.flyTo(json.data.coords,6,{duration:0.8});
    }
  },[selected]);

  const openSidebarDeepDive = async()=>{
    if(!selected) return;
    const res=await fetch(`${API}/states/${encodeURIComponent(selected.state)}`);
    const json=await res.json();
    if(json.success) setSidebarDeepDive(json.data);
  };

  // Build markers
  useEffect(()=>{
    if(!leafletRef.current||!states.length) return;
    const map=leafletRef.current;
    markersRef.current.forEach(m=>map.removeLayer(m));
    markersRef.current=[];

    const vals=states.map(s=>{
      if(indicator==='crime') return s.rates?.[2]<200?s.rates[2]:null;
      if(indicator==='aqi')   return s.avgAQI;
      if(indicator==='literacy') return s.literacy;
      if(indicator==='population') return s.pop;
      return null;
    }).filter(v=>v!==null&&v!==undefined);

    const min=Math.min(...vals), max=Math.max(...vals);

    states.forEach(s=>{
      if(!s.coords) return;
      let raw;
      if(indicator==='crime') raw=s.rates?.[2];
      else if(indicator==='aqi') raw=s.avgAQI;
      else if(indicator==='literacy') raw=s.literacy;
      else raw=s.pop;
      if(raw===null||raw===undefined) return;

      // For crime, cap outliers for color scale only
      const valForColor = indicator==='crime'&&raw>200?200:raw;
      const color=getMarkerColor(valForColor, min>200?min:min, max>200?200:max, indicator);

      const isSel=selected?.state===s.state;
      const size=isSel?24:16;
      const icon=L.divIcon({
        className:'',
        html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${isSel?'3px solid #fff':'2px solid rgba(255,255,255,0.25)'};box-shadow:0 0 ${isSel?18:8}px ${isSel?4:1}px ${color};cursor:pointer;transition:all 0.2s;"></div>`,
        iconSize:[size,size],iconAnchor:[size/2,size/2],
      });

      const displayVal=indicator==='population'?fmt(raw):indicator==='literacy'?raw?.toFixed(1)+'%':raw?.toFixed?raw.toFixed(1):raw;
      const indLabel=INDICATORS.find(i=>i.key===indicator)?.label;

      const marker=L.marker(s.coords,{icon}).addTo(map);
      marker.bindTooltip(
        `<div style="font-family:'DM Sans',sans-serif;min-width:140px"><div style="font-weight:700;font-size:0.85rem;margin-bottom:3px">${s.state}</div><div style="color:#94a3b8;font-size:0.72rem">${indLabel}: <span style="color:#f0f2fa;font-weight:600">${displayVal}</span></div></div>`,
        {className:'cl-tooltip',direction:'top',offset:[0,-8]}
      );
      marker.on('click',()=>selectState(s.state));
      markersRef.current.push(marker);
    });
  },[states,indicator,selected,selectState]);

  useEffect(()=>{
    if(leafletRef.current||!mapRef.current) return;
    const map=L.map(mapRef.current,{zoomControl:false,attributionControl:false}).setView([22,82],5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:18}).addTo(map);
    map.on('click',()=>{setSelected(null);setSidebarDeepDive(null);map.flyTo([22,82],5,{duration:0.8});});
    leafletRef.current=map;
  },[]);

  const avgCrime=summary?.avgCrime;
  const avgLiteracy=summary?.avgLiteracy;
  const avgAQI=summary?.avgAQI;

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>

      {/* NAVBAR */}
      <nav style={{height:52,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'0 1rem',background:'rgba(9,9,15,0.95)',backdropFilter:'blur(20px)',
        borderBottom:'1px solid var(--border)',zIndex:1000}}>
        <div style={{display:'flex',alignItems:'center',gap:'0.6rem'}}>
          <div style={{width:30,height:30,borderRadius:8,background:'linear-gradient(135deg,var(--accent),var(--accent2))',
            display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'0.75rem',color:'#fff'}}>CL</div>
          <div>
            <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'0.9rem',letterSpacing:'-0.3px',lineHeight:1.1}}>
              City<span style={{color:'var(--accent)'}}>Lens</span>
            </div>
            <div style={{fontSize:'0.6rem',color:'var(--muted)',lineHeight:1}}>India Safety Explorer</div>
          </div>
        </div>

        <div style={{display:'flex',gap:'0.2rem',background:'var(--surface)',borderRadius:10,padding:'0.2rem',border:'1px solid var(--border)'}}>
          {INDICATORS.map(ind=>(
            <button key={ind.key} onClick={()=>setIndicator(ind.key)} style={{
              padding:'0.3rem 0.75rem',borderRadius:8,border:'none',
              background:indicator===ind.key?'var(--card)':'transparent',
              color:indicator===ind.key?ind.color:'var(--muted)',
              fontSize:'0.75rem',fontWeight:indicator===ind.key?600:400,
              cursor:'pointer',fontFamily:'DM Sans,sans-serif',transition:'all 0.15s',
              boxShadow:indicator===ind.key?'0 1px 4px rgba(0,0,0,0.3)':'none',
            }}>{ind.icon} {ind.label}</button>
          ))}
        </div>

        <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
          <div style={{position:'relative'}}>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
              placeholder="Search state..."
              style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text)',
                padding:'0.3rem 0.75rem',fontSize:'0.75rem',outline:'none',fontFamily:'DM Sans,sans-serif',width:150}}/>
            {searchRes.length>0&&(
              <div style={{position:'absolute',top:'110%',left:0,width:'100%',background:'var(--card)',
                border:'1px solid var(--border)',borderRadius:8,zIndex:999,overflow:'hidden'}}>
                {searchRes.map(r=>(
                  <div key={r.state} onClick={()=>{selectState(r.state);setSearchQ('');setSearchRes([]);}}
                    style={{padding:'0.4rem 0.75rem',fontSize:'0.78rem',cursor:'pointer'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--border)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{r.state}</div>
                ))}
              </div>
            )}
          </div>

          <button onClick={()=>setShowTableau(true)} style={{
            display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.35rem 0.9rem',borderRadius:8,
            border:'1px solid rgba(232,76,30,0.3)',background:'rgba(232,76,30,0.1)',
            color:'var(--accent)',fontSize:'0.75rem',fontWeight:600,cursor:'pointer',fontFamily:'DM Sans,sans-serif',transition:'all 0.15s'}}
            onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,76,30,0.2)';}}
            onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,76,30,0.1)';}}>
            📊 View Tableau Dashboard
          </button>

          <div style={{display:'flex',alignItems:'center',gap:'0.35rem',padding:'0.3rem 0.7rem',
            borderRadius:999,background:'rgba(0,201,167,0.1)',border:'1px solid rgba(0,201,167,0.2)',
            fontSize:'0.68rem',fontWeight:600,color:'var(--teal)'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'var(--teal)',animation:'blink 2s infinite'}}/>
            36 States
          </div>
        </div>
      </nav>

      {/* BODY */}
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>

        {/* SIDEBAR */}
        <div style={{width:300,flexShrink:0,background:'var(--surface)',borderRight:'1px solid var(--border)',
          display:'flex',flexDirection:'column',overflow:'hidden',position:'relative'}}>

          {sidebarDeepDive&&(
            <SidebarDeepDive data={sidebarDeepDive} cities={sidebarDeepDive.cities||[]}
              onClose={()=>setSidebarDeepDive(null)}/>
          )}

          {loading?(
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'0.75rem'}}>
              <div style={{width:28,height:28,border:'2px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
              <span style={{fontSize:'0.78rem',color:'var(--muted)'}}>Loading data...</span>
            </div>
          ):!selected?(
            <div style={{flex:1,overflowY:'auto',padding:'1rem'}}>
              <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.8px',fontWeight:600,marginBottom:'0.75rem'}}>National Overview</div>
              <div style={{display:'grid',gap:'0.5rem'}}>
                <KPICard label="Avg Crime Rate" value={avgCrime} unit="per lakh" color="var(--accent)" sparkData={states.slice(0,8).map(s=>s.rates?.[2]).filter(Boolean)}/>
                <KPICard label="Avg Literacy" value={avgLiteracy} unit="%" color="var(--teal)" sparkData={states.slice(0,8).map(s=>s.literacy)}/>
                <KPICard label="Avg AQI" value={avgAQI} color="var(--accent2)" sparkData={states.slice(0,8).map(s=>s.avgAQI).filter(Boolean)}/>
                <KPICard label="Total Population" value={fmt(summary?.totalPop)} color="var(--blue)"/>
              </div>
            </div>
          ):(
            <div style={{flex:1,overflowY:'auto',animation:'slideLeft 0.3s ease'}}>
              <div style={{padding:'1rem',borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:'0.5rem'}}>
                  <div>
                    <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1.1rem',lineHeight:1.1}}>{selected.state}</div>
                    <div style={{fontSize:'0.7rem',color:'var(--muted)',marginTop:2}}>Pop: {fmt(selected.pop)}</div>
                  </div>
                  <button onClick={()=>{setSelected(null);leafletRef.current?.flyTo([22,82],5,{duration:0.8});}}
                    style={{background:'none',border:'1px solid var(--border)',borderRadius:6,color:'var(--muted)',
                      fontSize:'0.7rem',padding:'0.25rem 0.5rem',cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>✕</button>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.4rem',marginBottom:'0.75rem'}}>
                  {[
                    {label:'Crime Rate',val:selected.rates?.[2],unit:'/lakh',color:'var(--accent)',spark:selected.rates},
                    {label:'Literacy',val:selected.literacy+'%',color:'var(--teal)'},
                    {label:'Avg AQI',val:selected.avgAQI||'N/A',color:'var(--accent2)'},
                    {label:'Population',val:fmt(selected.pop),color:'var(--blue)'},
                  ].map(k=>(
                    <div key={k.label} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,padding:'0.6rem'}}>
                      <div style={{fontSize:'0.6rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'0.2rem'}}>{k.label}</div>
                      <div style={{fontFamily:'Syne,sans-serif',fontWeight:800,fontSize:'1rem',color:k.color}}>
                        {k.val}{k.unit&&<span style={{fontSize:'0.6rem',color:'var(--muted)',marginLeft:2}}>{k.unit}</span>}
                      </div>
                      {k.spark&&<Sparkline data={k.spark} color={k.color} width={80} height={18}/>}
                    </div>
                  ))}
                </div>

                {/* Deep Dive buttons */}
                <div style={{display:'flex',gap:'0.4rem'}}>
                  <button onClick={openSidebarDeepDive} style={{
                    flex:1,padding:'0.45rem',borderRadius:8,
                    background:'linear-gradient(135deg,rgba(232,76,30,0.15),rgba(245,166,35,0.1))',
                    border:'1px solid rgba(232,76,30,0.3)',color:'var(--accent)',
                    fontSize:'0.72rem',fontWeight:600,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>
                    📋 State Detail
                  </button>
                  <button onClick={()=>setDeepDiveModal(true)} style={{
                    flex:1,padding:'0.45rem',borderRadius:8,
                    background:'linear-gradient(135deg,rgba(79,142,247,0.15),rgba(0,201,167,0.1))',
                    border:'1px solid rgba(79,142,247,0.3)',color:'var(--blue)',
                    fontSize:'0.72rem',fontWeight:600,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>
                    🔍 Full Deep Dive
                  </button>
                </div>
              </div>

              <div style={{padding:'0.75rem 1rem',borderBottom:'1px solid var(--border)'}}>
                <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.8px',fontWeight:600,marginBottom:'0.5rem'}}>Crime Rate Trend</div>
                {['2021','2022','2023'].map((yr,i)=>{
                  const maxR=Math.max(...(selected.rates||[]));
                  return (
                    <div key={yr} style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.35rem'}}>
                      <span style={{fontSize:'0.65rem',color:'var(--muted)',width:28}}>{yr}</span>
                      <div style={{flex:1,height:4,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
                        <div style={{height:'100%',borderRadius:2,width:(selected.rates[i]/maxR*100)+'%',
                          background:i===2?'linear-gradient(90deg,var(--accent),var(--accent2))':'var(--border2)',transition:'width 0.8s ease'}}/>
                      </div>
                      <span style={{fontSize:'0.7rem',fontWeight:700,color:i===2?'var(--accent)':'var(--muted2)',width:35,textAlign:'right'}}>{selected.rates[i]}</span>
                    </div>
                  );
                })}
              </div>

              {selected.cities?.length>0&&(
                <div style={{padding:'0.75rem 1rem'}}>
                  <div style={{fontSize:'0.65rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.8px',fontWeight:600,marginBottom:'0.5rem'}}>Cities by AQI</div>
                  {selected.cities.slice(0,7).map((c,i)=>(
                    <div key={c.city} style={{display:'flex',alignItems:'center',gap:'0.5rem',padding:'0.3rem 0',borderBottom:'1px solid var(--border)'}}>
                      <span style={{fontSize:'0.62rem',color:'var(--muted)',width:14}}>{i+1}</span>
                      <span style={{fontSize:'0.75rem',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.city}</span>
                      <span style={{fontSize:'0.7rem',fontWeight:700,color:getAQIColor(c.aqi),
                        background:`${getAQIColor(c.aqi)}18`,padding:'0.1rem 0.4rem',borderRadius:4}}>{c.aqi}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* MAP */}
        <div style={{flex:1,position:'relative'}}>
          <div ref={mapRef} style={{width:'100%',height:'100%'}}/>

          {!selected&&summary&&(
            <div style={{position:'absolute',top:'0.75rem',left:'50%',transform:'translateX(-50%)',
              zIndex:500,display:'flex',gap:'0.4rem',pointerEvents:'none'}}>
              {[{val:avgCrime,label:'Avg Crime',color:'var(--accent)'},{val:avgLiteracy+'%',label:'Avg Literacy',color:'var(--teal)'},{val:avgAQI,label:'Avg AQI',color:'var(--accent2)'}].map(c=>(
                <div key={c.label} style={{background:'rgba(12,15,24,0.92)',border:'1px solid var(--border)',borderRadius:8,
                  padding:'0.35rem 0.7rem',backdropFilter:'blur(12px)',display:'flex',alignItems:'center',gap:'0.4rem',fontSize:'0.72rem'}}>
                  <strong style={{color:c.color}}>{c.val}</strong>
                  <span style={{color:'var(--muted)'}}>{c.label}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{position:'absolute',bottom:'1rem',left:'0.75rem',zIndex:500,
            background:'rgba(12,15,24,0.92)',border:'1px solid var(--border)',borderRadius:10,
            padding:'0.6rem 0.9rem',backdropFilter:'blur(12px)'}}>
            <div style={{fontSize:'0.62rem',color:'var(--muted2)',textTransform:'uppercase',letterSpacing:'0.8px',fontWeight:600,marginBottom:'0.35rem'}}>
              {INDICATORS.find(i=>i.key===indicator)?.label}
            </div>
            <div style={{display:'flex',gap:'3px',marginBottom:'0.2rem'}}>
              {[0.1,0.3,0.5,0.7,0.9].map(t=>(
                <div key={t} style={{width:18,height:6,borderRadius:2,
                  background:indicator==='literacy'?`rgba(20,${Math.round(80+(200-80)*t)},${Math.round(40+(100-40)*t)},0.85)`
                    :indicator==='population'?`rgba(79,142,247,${(0.35+0.65*t).toFixed(2)})`
                    :`rgba(${Math.round(20+(232-20)*t)},${Math.round(80+(30-80)*t)},30,0.85)`
                }}/>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.6rem',color:'var(--muted)'}}>
              <span>Low</span><span>High</span>
            </div>
          </div>

          {selected&&(
            <button onClick={()=>{setSelected(null);setSidebarDeepDive(null);leafletRef.current?.flyTo([22,82],5,{duration:0.8});}}
              style={{position:'absolute',bottom:'1rem',right:'1rem',zIndex:500,padding:'0.5rem 1rem',borderRadius:8,
                border:'1px solid var(--border)',background:'var(--card)',color:'var(--muted2)',fontSize:'0.75rem',
                cursor:'pointer',fontFamily:'DM Sans,sans-serif',backdropFilter:'blur(12px)'}}>
              ↩ Reset View
            </button>
          )}
        </div>
      </div>

      {/* DEEP DIVE FULLSCREEN MODAL */}
      {deepDiveModal&&selected&&(
        <DeepDiveModal
          data={selected}
          cities={selected.cities||[]}
          states={states}
          onClose={()=>setDeepDiveModal(false)}
        />
      )}

      {showTableau&&<TableauModal onClose={()=>setShowTableau(false)}/>}
    </div>
  );
}
