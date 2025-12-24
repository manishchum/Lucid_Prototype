'use strict';

const angleBetween = function (v0, v1) {
  const p = v0[0] * v1[0] + v0[1] * v1[1];
  const n = Math.sqrt((Math.pow(v0[0], 2) + Math.pow(v0[1], 2)) * (Math.pow(v1[0], 2) + Math.pow(v1[1], 2)));
  return (v0[0] * v1[1] - v0[1] * v1[0] < 0 ? -1 : 1) * Math.acos(p / n);
};

module.exports = {
  angleBetween,
};
