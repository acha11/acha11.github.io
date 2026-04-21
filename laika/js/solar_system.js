class SolarSystem {
  static PLANETS = (() => {
    const D = Math.PI / 180;
    return [
      // Fields: a (AU), e, i (rad), O=Ω (rad), w=ω from AN (rad), L0=mean longitude (rad)
      { a:0.38710, e:0.20563, i:7.005*D, O: 48.331*D, w: 29.124*D, L0:252.251*D }, // Mercury
      { a:0.72333, e:0.00677, i:3.394*D, O: 76.680*D, w: 54.884*D, L0:181.979*D }, // Venus
      { a:1.00000, e:0.01671, i:0.001*D, O:  0.000*D, w:102.937*D, L0:100.465*D }, // Earth
      { a:1.52366, e:0.09340, i:1.849*D, O: 49.558*D, w:286.502*D, L0:355.453*D }, // Mars
      { a:5.20336, e:0.04839, i:1.303*D, O:100.464*D, w:273.867*D, L0: 34.396*D }, // Jupiter
      { a:9.53707, e:0.05415, i:2.485*D, O:113.665*D, w:339.392*D, L0: 49.955*D }, // Saturn
      { a:19.1913, e:0.04717, i:0.773*D, O: 74.006*D, w: 96.541*D, L0:313.232*D }, // Uranus
      { a:30.0690, e:0.00859, i:1.770*D, O:131.784*D, w:273.187*D, L0:304.881*D }, // Neptune
      { a:39.4817, e:0.24882, i:17.14*D, O:110.299*D, w:113.834*D, L0:238.929*D }, // Pluto
    ];
  })();

  static _solveKepler(M, e) {
    let E = M;
    for (let k = 0; k < 8; k++)
      E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return E;
  }

  // Eccentric anomaly for planet p at t years since J2000
  static eccAnomaly(p, t) {
    const n  = (2 * Math.PI) / Math.pow(p.a, 1.5);
    const M0 = p.L0 - p.O - p.w;
    const M  = ((M0 + n * t) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return SolarSystem._solveKepler(M, p.e);
  }

  // Ecliptic 3D position at eccentric anomaly E, in display units (√AU scaled)
  static orbitPoint(p, E) {
    const ad = Math.sqrt(p.a);
    const xp = ad * (Math.cos(E) - p.e);
    const yp = ad * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
    // Rotate from orbital plane to ecliptic: Rz(Ω)·Rx(i)·Rz(ω)
    const cO = Math.cos(p.O), sO = Math.sin(p.O);
    const cw = Math.cos(p.w), sw = Math.sin(p.w);
    const ci = Math.cos(p.i), si = Math.sin(p.i);
    return [
      ( cO*cw - sO*sw*ci) * xp + (-cO*sw - sO*cw*ci) * yp,
      ( sO*cw + cO*sw*ci) * xp + (-sO*sw + cO*cw*ci) * yp,
      (        si*sw     ) * xp + (        si*cw     ) * yp,
    ];
  }

  // Ecliptic 3D position of planet p at t years since J2000
  static planetPosition(p, t) {
    return SolarSystem.orbitPoint(p, SolarSystem.eccAnomaly(p, t));
  }
}
