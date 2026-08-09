export interface StoredZipEntry {
  name: string;
  data: Uint8Array;
  modifiedAt?: Date;
}

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(value: Date) {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function createStoredZip(entries: StoredZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replaceAll("\\", "/").replace(/^\/+/, ""));
    const checksum = crc32(entry.data);
    const { time, date } = dosDateTime(entry.modifiedAt ?? new Date());
    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, time);
    write16(localView, 12, date);
    write32(localView, 14, checksum);
    write32(localView, 18, entry.data.byteLength);
    write32(localView, 22, entry.data.byteLength);
    write16(localView, 26, name.byteLength);
    write16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, time);
    write16(centralView, 14, date);
    write32(centralView, 16, checksum);
    write32(centralView, 20, entry.data.byteLength);
    write32(centralView, 24, entry.data.byteLength);
    write16(centralView, 28, name.byteLength);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);

    localOffset += local.byteLength + entry.data.byteLength;
  }

  const centralDirectory = join(centralParts);
  const footer = new Uint8Array(22);
  const footerView = new DataView(footer.buffer);
  write32(footerView, 0, 0x06054b50);
  write16(footerView, 4, 0);
  write16(footerView, 6, 0);
  write16(footerView, 8, entries.length);
  write16(footerView, 10, entries.length);
  write32(footerView, 12, centralDirectory.byteLength);
  write32(footerView, 16, localOffset);
  write16(footerView, 20, 0);
  return join([...localParts, centralDirectory, footer]);
}
