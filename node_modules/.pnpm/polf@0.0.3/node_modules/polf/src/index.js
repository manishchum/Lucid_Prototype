'use strict';

/* eslint global-require: 0 */

module.exports = {
  lineXY: require('./line').default,
  cubicBezierXY: require('./cubic-bezier').default,
  quadraticBezierXY: require('./quadratic-bezier').default,
  ellipticalArcXY: require('./elliptical-arc').default,
};
