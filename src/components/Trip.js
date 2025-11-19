/* global window */
// Trip.js - 교수님 형식 유지(토큰/Mapbox 그대로), 필요한 부분만 개선

import React, { useState, useEffect, useCallback, useMemo } from "react";

import DeckGL from "@deck.gl/react";
import { Map } from "react-map-gl"; // ✅ Mapbox 버전 유지

import { AmbientLight, PointLight, LightingEffect } from "@deck.gl/core";
import { TripsLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer, ArcLayer } from "@deck.gl/layers";

import Slider from "@mui/material/Slider";
import "../css/trip.css";

/* -------------------- 조명 -------------------- */
const ambientLight = new AmbientLight({ color: [255, 255, 255], intensity: 1.0 });
const pointLight = new PointLight({ color: [255, 255, 255], intensity: 2.0, position: [127.13, 37.45, 5000] });
const lightingEffect = new LightingEffect({ ambientLight, pointLight });
const DEFAULT_THEME = { effects: [lightingEffect] };

/* -------------------- 초기 뷰(성남) -------------------- */
const INITIAL_VIEW_STATE = {
  longitude: 127.126, latitude: 37.42, zoom: 11.8, pitch: 30, bearing: 0
};

/* -------------------- Mapbox 스타일/토큰 (교수님 형식 유지) -------------------- */
const mapStyle = "mapbox://styles/spear5306/ckzcz5m8w002814o2coz02sjc"; // 교수님 코드 그대로
const MAPBOX_TOKEN = `pk.eyJ1Ijoic2hlcnJ5MTAyNCIsImEiOiJjbG00dmtic3YwbGNoM2Zxb3V5NmhxZDZ6In0.ZBrAsHLwNihh7xqTify5hQ`; // 그대로

/* -------------------- 시간/표시 유틸 -------------------- */
const addZero = (v) => (v.toString().length < 2 ? "0" + v : v);
const toHHMM = (t) => `${addZero(parseInt((Math.round(t) / 60) % 24))}:${addZero(Math.round(t) % 60)}`;

/* -------------------- 설정(아크 토글) -------------------- */
const SHOW_MATCH_ARCS = false; // 차량→픽업 링크
const SHOW_OCC_ARCS   = false; // 현재→목적지 링크

/* -------------------- 데이터 자동 로드 -------------------- */
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

const Trip = (props) => {
  const [time, setTime] = useState(7*60);
  const [animation] = useState({});
  const [autoTrip, setAutoTrip] = useState(null);
  const [autoPax, setAutoPax] = useState(null);

  // props 우선, 없으면 /public/data 사용
  const trip = props.trip ?? autoTrip ?? [];
  const passengers = props.passengers ?? autoPax ?? [];

  useEffect(() => {
    if (props.trip && props.passengers) return;
    (async () => {
      try {
        const [t, p] = await Promise.all([
          fetchJSON("/data/trips.json"),
          fetchJSON("/data/passengers.json"),
        ]);
        setAutoTrip(t);
        setAutoPax(p);
      } catch (e) {
        console.error("데이터 자동 로드 실패:", e);
      }
    })();
  }, [props.trip, props.passengers]);

  /* -------------------- 최대 시간 계산 -------------------- */
  const maxTripTime = useMemo(() => {
    let m = 0;
    (trip || []).forEach(t => {
      const last = t?.timestamp?.[t.timestamp.length - 1];
      if (typeof last === "number" && last > m) m = last;
    });
    return m;
  }, [trip]);

  const maxPaxTime = useMemo(() => {
    let m = 0;
    (passengers || []).forEach(p => {
      const last = p?.timestamp?.[p.timestamp.length - 1];
      if (typeof last === "number" && last > m) m = last;
    });
    return m;
  }, [passengers]);

  const maxTime = useMemo(() => {
    const m = Math.max(60, maxTripTime, maxPaxTime);
    return Number.isFinite(m) && m > 0 ? m : 60;
  }, [maxTripTime, maxPaxTime]);

  /* -------------------- 애니메이션 -------------------- */
  const step = useCallback((t) => (t > maxTime ? 0 : t + 0.01 * 2), [maxTime]); // speed=0.5
  const animate = useCallback(() => {
    setTime((t) => step(t));
    animation.id = window.requestAnimationFrame(animate);
  }, [animation, step]);

  useEffect(() => {
    animation.id = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animation.id);
  }, [animation, animate]);

  /* -------------------- 레이어별 데이터 -------------------- */
  // 픽업 전 승객만 표시
  const visiblePassengers = useMemo(() => {
    if (!Array.isArray(passengers)) return [];
    return passengers.filter(
      (p) =>
        Array.isArray(p.timestamp) &&
        p.timestamp.length === 2 &&
        p.timestamp[0] <= time &&
        time < p.timestamp[1]
    );
  }, [passengers, time]);

  // 목적지(픽업~도착 사이에만)
  const destinationsNow = useMemo(() => {
    if (!Array.isArray(trip)) return [];
    const arr = [];
    for (const t of trip) {
      if (!t?.route || !t?.timestamp || t.route.length < 2 || t.timestamp.length < 2) continue;
      const drop = t.route[t.route.length - 1];
      const start = t.timestamp.length > 1 ? t.timestamp[1] : t.timestamp[0];
      const end   = t.timestamp[t.timestamp.length - 1];
      if (typeof start === "number" && typeof end === "number" && time >= start && time <= end) {
        arr.push({ location: drop });
      }
    }
    return arr;
  }, [trip, time]);

  // (옵션) 매칭 아크: 차량→픽업
  const matchArcs = useMemo(() => {
    if (!SHOW_MATCH_ARCS || !Array.isArray(trip)) return [];
    const arcs = [];
    for (const t of trip) {
      if (!t?.route || !t?.timestamp || t.route.length < 2 || t.timestamp.length < 2) continue;
      const ts = t.timestamp, rt = t.route;
      const start = ts[0], pickupTime = ts[1];
      if (typeof start !== "number" || typeof pickupTime !== "number") continue;
      if (time < start || time > pickupTime) continue;

      // 현재 위치 보간
      let idx = 0;
      for (let k = 0; k < ts.length - 1; k++) {
        if (typeof ts[k] === "number" && typeof ts[k + 1] === "number" && ts[k] <= time && time < ts[k + 1]) { idx = k; break; }
        if (time >= ts[ts.length - 1]) idx = ts.length - 2;
      }
      const a = rt[Math.max(0, Math.min(idx, rt.length - 1))];
      const b = rt[Math.max(0, Math.min(idx + 1, rt.length - 1))];
      const t0 = ts[Math.max(0, Math.min(idx, ts.length - 1))];
      const t1 = ts[Math.max(0, Math.min(idx + 1, ts.length - 1))];
      let curr = a;
      if (typeof t0 === "number" && typeof t1 === "number" && t1 > t0) {
        const alpha = Math.max(0, Math.min(1, (time - t0) / (t1 - t0)));
        curr = [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha];
      }
      const pickup = rt[1];
      if (Array.isArray(curr) && Array.isArray(pickup)) arcs.push({ source: curr, target: pickup });
    }
    return arcs;
  }, [trip, time]);

  // (옵션) 탑승중 아크: 현재→목적지
  const occArcs = useMemo(() => {
    if (!SHOW_OCC_ARCS || !Array.isArray(trip)) return [];
    const arcs = [];
    for (const t of trip) {
      if (!t?.route || !t?.timestamp || t.route.length < 2 || t.timestamp.length < 2) continue;
      const ts = t.timestamp, rt = t.route;
      const pickupTime = ts[1], dropTime = ts[ts.length - 1];
      if (typeof pickupTime !== "number" || typeof dropTime !== "number") continue;
      if (time < pickupTime || time > dropTime) continue;

      // 현재 위치 보간
      let idx = 0;
      for (let k = 0; k < ts.length - 1; k++) {
        if (typeof ts[k] === "number" && typeof ts[k + 1] === "number" && ts[k] <= time && time < ts[k + 1]) { idx = k; break; }
        if (time >= ts[ts.length - 1]) idx = ts.length - 2;
      }
      const a = rt[Math.max(0, Math.min(idx, rt.length - 1))];
      const b = rt[Math.max(0, Math.min(idx + 1, rt.length - 1))];
      const t0 = ts[Math.max(0, Math.min(idx, ts.length - 1))];
      const t1 = ts[Math.max(0, Math.min(idx + 1, ts.length - 1))];
      let curr = a;
      if (typeof t0 === "number" && typeof t1 === "number" && t1 > t0) {
        const alpha = Math.max(0, Math.min(1, (time - t0) / (t1 - t0)));
        curr = [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha];
      }
      const dest = rt[rt.length - 1];
      if (Array.isArray(curr) && Array.isArray(dest)) arcs.push({ source: curr, target: dest });
    }
    return arcs;
  }, [trip, time]);

  /* -------------------- 레이어 -------------------- */
  const layers = [
    new TripsLayer({
      id: "trips",
      data: trip,
      getPath: (d) => d.route,            // [[lon,lat], ...]
      getTimestamps: (d) => d.timestamp,  // [min, ...]
      getColor: [135, 206, 235],
      opacity: 1,
      widthMinPixels: 7,
      rounded: true,
      capRounded: true,
      jointRounded: true,
      trailLength: 0.5,
      currentTime: time,
      shadowEnabled: false,
    }),
    new ScatterplotLayer({
      id: "passengers",
      data: visiblePassengers,
      getPosition: (d) => d.location,     // [lon,lat]
      getFillColor: [255, 255, 255],
      getRadius: 6,
      radiusUnits: "pixels",
      pickable: true,
      updateTriggers: { getPosition: [time] },
    }),
    new ScatterplotLayer({
      id: "destinations",
      data: destinationsNow,
      getPosition: (d) => d.location,
      getFillColor: [255, 165, 0],
      getRadius: 5,
      radiusUnits: "pixels",
      pickable: false,
      updateTriggers: { getPosition: [time] },
    }),
    ...(SHOW_MATCH_ARCS
      ? [
          new ArcLayer({
            id: "match-arcs",
            data: matchArcs,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getSourceColor: [255, 255, 255],
            getTargetColor: [255, 255, 255],
            getWidth: 3,
            pickable: false,
            updateTriggers: { getSourcePosition: [time], getTargetPosition: [time] },
          }),
        ]
      : []),
    ...(SHOW_OCC_ARCS
      ? [
          new ArcLayer({
            id: "occupied-arcs",
            data: occArcs,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getSourceColor: [30, 144, 255],
            getTargetColor: [30, 144, 255],
            getWidth: 1.5,
            pickable: false,
            updateTriggers: { getSourcePosition: [time], getTargetPosition: [time] },
          }),
        ]
      : []),
  ];

  /* -------------------- 렌더 -------------------- */
  const onSlider = (e) => setTime(e.target.value);
  const [hh, mm] = useMemo(() => [addZero(parseInt((Math.round(time) / 60) % 24)), addZero(Math.round(time) % 60)], [time]);

  return (
    <div className="trip-container" style={{ position: "relative" }}>
      <DeckGL effects={DEFAULT_THEME.effects} initialViewState={INITIAL_VIEW_STATE} controller layers={layers}>
        {/* ✅ 교수님 형식: Mapbox + 토큰 그대로 */}
        <Map mapStyle={mapStyle} mapboxAccessToken={MAPBOX_TOKEN} preventStyleDiffing />
      </DeckGL>

      <h1 className="time">TIME : {`${hh} : ${mm}`}</h1>

      <Slider id="slider" value={time} min={7*60} max={maxTime} onChange={onSlider} track="inverted" />
    </div>
  );
};

export default Trip;
