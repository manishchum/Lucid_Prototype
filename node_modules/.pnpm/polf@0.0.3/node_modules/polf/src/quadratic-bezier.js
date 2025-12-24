'use strict';

// Quadratic Bezier algorithm
// B(t) = (1-t)**2 * p0 + 2*(1-t)*t *p1 + t**2 * p2
const quadraticBezierXY = function (p0, p1, p2, t) {
  return [
    Math.pow(1 - t, 2) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    Math.pow(1 - t, 2) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
  ];
};

exports.default = quadraticBezierXY;
