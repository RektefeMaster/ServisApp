import type { FastifyRequest } from 'fastify';

/** IPv4 ya da IPv6 görünümlü bir değer mi — log ve kova anahtarı için yeterli. */
const IP_LIKE = /^[0-9a-fA-F:.]{3,45}$/;

export type ClientIp = (request: FastifyRequest) => string;

/**
 * Hız sınırlarının anahtarı.
 *
 * Vekil arkasında `request.ip` bütün istekler için aynıdır (Fly Proxy'nin özel
 * ağ adresi). Bu, IP başına kurulmuş her sınırı küresel bir sınıra çevirir:
 * tek bir bozuk istemcinin 40 hatalı jetonu, sahadaki bütün velileri ve
 * personeli 429'a kilitleyebiliyordu.
 *
 * Çözüm CIDR tahmin etmek değil, platformun kendi yazdığı başlığı okumaktır.
 * Fly Proxy `Fly-Client-IP`'yi her istekte kendisi üretir ve istemciden geleni
 * ezer. Başlık yapılandırılmamışsa davranış eskisi gibi kalır.
 */
export function createClientIp(headerName: string | undefined): ClientIp {
  return (request) => {
    if (headerName) {
      const raw = request.headers[headerName];
      const value = Array.isArray(raw) ? raw[0] : raw;
      const first = value?.split(',')[0]?.trim();
      if (first && IP_LIKE.test(first)) return first;
    }
    return request.ip || 'unknown';
  };
}
