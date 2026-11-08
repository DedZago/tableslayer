// Injected into the bloodied token's MeshBasicMaterial (helpers/bloodOverlay.ts).
// The rim is baked into the map; the drips are drawn here from the state of the small simulation in
// helpers/bloodDrips.ts, so they move without re-rasterizing anything.
// Coordinates are token units on canvas axes (y down = screen down), centred on the token.
#define BLOOD_DRIPS 6

uniform vec4 uBloodDrip[BLOOD_DRIPS]; // x, y, width, trail length; width 0 = unused slot
uniform vec4 uBloodFlow[BLOOD_DRIPS]; // head radius, bead position, bead radius, wobble phase
uniform vec4 uBloodDrop[BLOOD_DRIPS]; // drop offset below the head, radius, alpha, stretch
uniform vec3 uBloodDeep;
uniform vec3 uBloodBright;
uniform vec3 uBloodDark;
uniform vec3 uBloodGloss;

const float DRIP_HALO = 0.02;
const float TOKEN_TOP = -0.45;

vec4 bloodOver(vec4 top, vec4 bottom) {
  float a = top.a + bottom.a * (1.0 - top.a);
  vec3 rgb = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / max(a, 1e-4);
  return vec4(rgb, a);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Trails meander slightly instead of running ruler-straight
float wobble(float y, float w, float phase) {
  return 0.06 * w * sin(y * 22.0 + phase) * smoothstep(0.0, 0.04, y);
}

// Rounded cone from a circle of radius r1 at the origin to one of radius r2 at (0, h), y up (exact)
float unevenCapsule(vec2 p, float r1, float r2, float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}

// Falling drop: round at the bottom, drawn to a point on top, longer the faster it falls
float teardrop(vec2 q, float r, float stretch) {
  return unevenCapsule(vec2(q.x, -q.y), r, r * 0.12, r * (1.15 + stretch));
}

// Vertical ellipse; cheap approximation that is exact enough for anti-aliasing at these sizes
float ellipse(vec2 q, vec2 r) {
  float k = length(q / r);
  return (k - 1.0) * min(r.x, r.y);
}

vec4 bloodDrips(vec4 base, vec2 uv, float alpha) {
  vec2 p = (uv - 0.5) * BLOOD_QUAD_SCALE;
  p.y = -p.y;
  float aa = fwidth(p.x);
  float fill = 0.0;
  float halo = 0.0;
  float gloss = 0.0;

  for (int i = 0; i < BLOOD_DRIPS; i++) {
    vec4 drip = uBloodDrip[i];
    vec4 flow = uBloodFlow[i];
    vec4 drop = uBloodDrop[i];
    float w = drip.z;
    float len = drip.w;
    vec2 q = p - drip.xy;
    float reach = len + flow.x * 1.8 + drop.x + drop.y * 2.0 + DRIP_HALO;
    // Cheap reject: most fragments are nowhere near a drip's column
    if (w <= 0.0 || abs(q.x) > 1.6 * w + DRIP_HALO || q.y < 0.0 || q.y > reach) continue;

    // Trail: flared where it leaves the rim, thinning to a film towards the head
    float along = clamp(q.y / max(len, 1e-4), 0.0, 1.0);
    float halfWidth = w * (0.36 + 0.14 * (1.0 - along) + 0.32 * exp(-q.y / 0.02));
    float trail = max(abs(q.x - wobble(q.y, w, flow.w)) - halfWidth, max(-q.y, q.y - len));

    // Head hangs just below the end of the trail, slightly drop-shaped
    vec2 headCenter = vec2(wobble(len, w, flow.w), len + flow.x * 0.35);
    float head = ellipse(q - headCenter, vec2(flow.x, flow.x * 1.12));
    float d = smin(trail, head, 0.45 * w);

    // A pulse rolling down the wet trail
    if (flow.z > 0.0) {
      vec2 beadCenter = vec2(wobble(flow.y, w, flow.w), flow.y);
      d = smin(d, ellipse(q - beadCenter, vec2(flow.z, flow.z * 1.6)), 0.5 * w);
    }

    // A falling drop, still necked to the head right after it pinches off
    float dropD = 1e3;
    vec2 dropCenter = vec2(headCenter.x, headCenter.y + flow.x * 0.75 + drop.x + drop.y);
    if (drop.y > 0.0) {
      dropD = teardrop(q - dropCenter, drop.y, drop.w);
      float neck = 0.5 * w * (1.0 - smoothstep(0.0, 0.03, drop.x));
      if (neck > 0.0) {
        d = smin(d, dropD, neck);
        dropD = 1e3;
      }
    }

    float body = 1.0 - smoothstep(-aa, aa, d);
    float dropBody = (1.0 - smoothstep(-aa, aa, dropD)) * drop.z;
    fill = max(fill, max(body, dropBody));

    // No dark edge where the trail leaves the rim, or it would draw a line across the blood
    float edge = max(1.0 - smoothstep(0.0, DRIP_HALO, d), drop.z * (1.0 - smoothstep(0.0, DRIP_HALO, dropD)));
    halo = max(halo, edge * smoothstep(0.015, 0.045, q.y));

    // Wet highlights: a streak down the trail's left side and a spot on each round blob
    float streak = (1.0 - smoothstep(0.07 * w, 0.07 * w + aa, abs(q.x - wobble(q.y, w, flow.w) + 0.2 * w))) *
      smoothstep(0.05, 0.09, q.y) * (1.0 - smoothstep(len - 0.02, len, q.y));
    float headSpot = 1.0 - smoothstep(0.08 * flow.x, 0.2 * flow.x + aa,
      length(q - headCenter - vec2(-0.35, -0.3) * flow.x));
    gloss = max(gloss, max(streak * 0.7, headSpot) * body);
    float dropSpot = 1.0 - smoothstep(0.08 * drop.y, 0.22 * drop.y + aa,
      length(q - dropCenter - vec2(-0.34, -0.22) * drop.y));
    gloss = max(gloss, dropSpot * dropBody * step(0.0, drop.y));
  }

  if (fill <= 0.0 && halo <= 0.0) return base;

  float t = (p.y - TOKEN_TOP) / 1.25;
  vec3 color = t < 0.6 ? mix(uBloodDeep, uBloodBright, t / 0.6) : mix(uBloodBright, uBloodDeep, clamp((t - 0.6) / 0.4, 0.0, 1.0));
  color = mix(color, uBloodGloss, 0.6 * gloss);

  vec4 under = bloodOver(base, vec4(uBloodDark, 0.85 * halo * alpha));
  return bloodOver(vec4(color, fill * alpha), under);
}
