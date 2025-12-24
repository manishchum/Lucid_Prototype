'use strict';

// Cubic bezier algorithm:
// B(t) = (1-t)**3 * p0 + 3*(1-t)**2 * t * p1 + 3*(1-t)**2 * p2 + t**3 * p3 , 0 <= t <= 1
const cubicBezierXY = function (p0, p1, p2, p3, t) {
  return [
    Math.pow(1 - t, 3) * p0[0] + 3 * t * Math.pow(1 - t, 2) * p1[0] +
      3 * t * t * (1 - t) * p2[0] + t * t * t * p3[0],
    Math.pow(1 - t, 3) * p0[1] + 3 * t * Math.pow(1 - t, 2) * p1[1] +
      3 * t * t * (1 - t) * p2[1] + t * t * t * p3[1]
  ];
};

exports.default = cubicBezierXY;
