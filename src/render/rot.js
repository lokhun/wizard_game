// Set an object's rotation from XYZ angles, writing its quaternion straight from them (three's own XYZ
// formula): the same numbers rotation.set gives, without the change callback and the order switch
// behind it. For the bones every posed body sets every frame (an order other than XYZ falls back).
export function setRotXYZ(obj, x, y, z) {
  const R = obj.rotation;
  if (R._order !== 'XYZ') { R.set(x, y, z); return; }
  R._x = x; R._y = y; R._z = z;
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  const Q = obj.quaternion;
  Q._x = s1 * c2 * c3 + c1 * s2 * s3; Q._y = c1 * s2 * c3 - s1 * c2 * s3;
  Q._z = c1 * c2 * s3 + s1 * s2 * c3; Q._w = c1 * c2 * c3 - s1 * s2 * s3;
}
