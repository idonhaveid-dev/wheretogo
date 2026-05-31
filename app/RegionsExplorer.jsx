"use client";

import { useMemo, useState } from "react";

const categoryLabels = {
  food: "맛집",
  domestic_travel: "국내여행"
};

const matchLabels = {
  exact_place: "장소 확인",
  event_on_place: "행사/축제",
  alias_match: "이름 매칭",
  weak_match: "검토 필요"
};

const categoryFilters = [
  { value: "all", label: "전체" },
  { value: "food", label: "맛집" },
  { value: "domestic_travel", label: "국내여행" }
];

const scopeFilters = [
  { value: "all", label: "전체" },
  { value: "metro", label: "서울/수도권" },
  { value: "national", label: "전국" }
];

// 서울/수도권으로 분류할 지역명 목록.
const SEOUL_METRO = new Set([
  "성수", "서울숲", "연남동", "한남동", "을지로", "잠실", "홍대", "합정", "망원", "문래",
  "익선동", "안국", "북촌", "서촌", "종로", "명동", "강남", "신사", "가로수길", "압구정",
  "청담", "삼성", "코엑스", "여의도", "더현대서울", "용산", "이태원", "마포", "공덕", "성북",
  "혜화", "대학로", "사당", "방배", "서초", "교대", "양재", "송파", "석촌", "올림픽공원",
  "강동", "천호", "마곡", "상암", "김포", "인천", "송도", "판교", "분당", "정자",
  "광교", "수원", "일산", "고양", "파주", "하남", "미사", "남양주", "구리", "의정부",
  "부천", "안양", "과천", "광명"
]);

function formatScore(value) {
  const number = Number(value || 0);
  return number.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function formatLift(value) {
  const number = Number(value || 0);
  return number.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function inScope(region, scope) {
  if (scope === "metro") return SEOUL_METRO.has(region);
  if (scope === "national") return !SEOUL_METRO.has(region);
  return true;
}

// 카드에 보여줄 "왜 뜨는지" 문구(최대 2줄)를 만든다.
function buildReasons(place) {
  const reasons = [];
  if (place.today_count > 0 && place.lift) {
    reasons.push(`오늘 ${place.today_count}건 언급 · 이전 평균 대비 ${formatLift(place.lift)}배`);
  } else if (place.blog_post_count > 0) {
    reasons.push(`최근 블로그 ${place.blog_post_count}건 언급`);
  }
  if (place.match_type === "event_on_place") {
    reasons.push("블로그에서는 이벤트명으로 언급, 실제 장소와 연결됨");
  } else if (place.match_type === "alias_match") {
    reasons.push("블로그 표현과 공식 장소명이 달라 별칭으로 연결됨");
  }
  return reasons;
}

export default function RegionsExplorer({ regions }) {
  const [category, setCategory] = useState("all");
  const [scope, setScope] = useState("all");

  const filteredRegions = useMemo(() => {
    return regions
      .map((region) => {
        const places = category === "all"
          ? region.places
          : region.places.filter((place) => place.category === category);
        if (places.length === 0) return null;
        return {
          ...region,
          places,
          place_count: places.length,
          top_places: places.slice(0, 4).map((place) => place.display_name),
          hot_score: Number(places.reduce((sum, place) => sum + place.hot_score, 0).toFixed(2))
        };
      })
      .filter(Boolean)
      .filter((region) => inScope(region.region, scope))
      .sort((a, b) => b.hot_score - a.hot_score || b.place_count - a.place_count)
      .map((region, index) => ({ ...region, rank: index + 1 }));
  }, [regions, category, scope]);

  const featured = filteredRegions[0];

  return (
    <>
      <div className="filters" role="group" aria-label="필터">
        <div className="filter-group">
          <span className="filter-label">카테고리</span>
          {categoryFilters.map((option) => (
            <button
              type="button"
              key={option.value}
              className="filter-btn"
              aria-pressed={category === option.value}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">지역 범위</span>
          {scopeFilters.map((option) => (
            <button
              type="button"
              key={option.value}
              className="filter-btn"
              aria-pressed={scope === option.value}
              onClick={() => setScope(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section className="layout">
        <aside className="regions" aria-label="오늘 뜨는 지역">
          <div className="section-title">
            <h2>오늘 뜨는 지역</h2>
            <p>hot score 합산 기준</p>
          </div>
          <div className="region-list">
            {filteredRegions.length === 0 ? (
              <p className="empty">조건에 맞는 지역이 없습니다.</p>
            ) : (
              filteredRegions.map((region) => (
                <a className="region-row" href={`#region-${region.slug}`} key={region.region}>
                  <span className="rank">{region.rank}</span>
                  <span>
                    <strong>{region.region}</strong>
                    <em>{region.place_count}개 후보</em>
                  </span>
                  <b>{formatScore(region.hot_score)}</b>
                </a>
              ))
            )}
          </div>
        </aside>

        <section className="content">
          {featured ? (
            <section className="spotlight" id={`region-${featured.slug}`}>
              <div>
                <p className="eyebrow">Top Region</p>
                <h2>{featured.region}</h2>
                <p>{featured.top_places.slice(0, 3).join(" · ")}</p>
              </div>
              <strong>{formatScore(featured.hot_score)}</strong>
            </section>
          ) : null}

          {filteredRegions.map((region) => (
            <section className="region-section" id={`region-${region.slug}`} key={region.region}>
              <div className="section-title">
                <h2>{region.region}</h2>
                <p>{region.place_count}개 장소/이벤트</p>
              </div>

              <div className="place-grid">
                {region.places.map((place) => {
                  const reasons = buildReasons(place);
                  return (
                    <article className="place-card" key={`${region.region}-${place.rank}-${place.display_name}`}>
                      <div className="card-head">
                        <span>{categoryLabels[place.category] || place.category}</span>
                        <span>{matchLabels[place.match_type] || place.match_type}</span>
                      </div>
                      <h3>{place.display_name}</h3>
                      {place.official_place_name && place.official_place_name !== place.display_name ? (
                        <p className="official">공식 장소: {place.official_place_name}</p>
                      ) : null}
                      {reasons.length > 0 ? (
                        <div className="reason">
                          {reasons.map((reason) => (
                            <span key={reason}>{reason}</span>
                          ))}
                        </div>
                      ) : null}
                      <dl>
                        <div>
                          <dt>점수</dt>
                          <dd>{formatScore(place.hot_score)}</dd>
                        </div>
                        <div>
                          <dt>언급</dt>
                          <dd>{place.blog_post_count}</dd>
                        </div>
                        <div>
                          <dt>검증</dt>
                          <dd>{place.match_score}</dd>
                        </div>
                      </dl>
                      <p className="address">{place.roadAddress || place.address || "주소 확인 필요"}</p>
                      {place.sample_links?.[0] ? (
                        <a className="sample-link" href={place.sample_links[0]} target="_blank" rel="noreferrer">
                          블로그 샘플 보기
                        </a>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </section>
      </section>
    </>
  );
}
