import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(directory, '../..');
const channelName = process.env.FABRIC_CHANNEL_NAME;
if (!/^insurance-phase2-[a-z0-9-]+$/.test(channelName ?? '')) {
  throw new Error('Set FABRIC_CHANNEL_NAME to an isolated insurance-phase2-* channel before running Caliper');
}
const domain = 'insurer.blockinsure.test';
const orgRoot = path.join(projectRoot, 'network', 'organizations', 'peerOrganizations', domain);
const userMsp = path.join(orgRoot, 'users', `insurerAdmin@${domain}`, 'msp');
const policyholderMsp = path.join(orgRoot, 'users', `policyholder1@${domain}`, 'msp');

async function onlyFile(folder) {
  const files = (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile() && !entry.name.startsWith('.'));
  if (files.length !== 1) throw new Error(`Expected exactly one credential in ${folder}; found ${files.length}`);
  return path.join(folder, files[0].name);
}

function containerPath(hostPath) {
  const relative = path.relative(projectRoot, hostPath).split(path.sep).join('/');
  return `/hyperledger/caliper/workspace/${relative}`;
}

const [keyPath, certPath, policyholderKeyPath, policyholderCertPath] = await Promise.all([
  onlyFile(path.join(userMsp, 'keystore')),
  onlyFile(path.join(userMsp, 'signcerts')),
  onlyFile(path.join(policyholderMsp, 'keystore')),
  onlyFile(path.join(policyholderMsp, 'signcerts')),
]);
const tlsPath = path.join(orgRoot, 'peers', `peer0.${domain}`, 'tls', 'ca.crt');
const generated = path.join(directory, 'generated');
await mkdir(generated, { recursive: true });

const connection = {
  name: 'block-insure-caliper', version: '1.0.0',
  client: { organization: 'InsurerMSP', connection: { timeout: { peer: { endorser: '300' } } } },
  organizations: { InsurerMSP: { mspid: 'InsurerMSP', peers: [`peer0.${domain}`] } },
  peers: {
    [`peer0.${domain}`]: {
      url: 'grpcs://host.docker.internal:7051',
      tlsCACerts: { path: containerPath(tlsPath) },
      grpcOptions: { 'ssl-target-name-override': `peer0.${domain}`, hostnameOverride: `peer0.${domain}` },
    },
  },
  channels: { [channelName]: { peers: { [`peer0.${domain}`]: { endorsingPeer: true, chaincodeQuery: true, ledgerQuery: true, eventSource: true } } } },
};
await writeFile(path.join(generated, 'connection-insurer.json'), `${JSON.stringify(connection, null, 2)}\n`);

const yaml = `name: Block Insure Fabric\nversion: "2.0.0"\ncaliper:\n  blockchain: fabric\nchannels:\n  - channelName: ${channelName}\n    contracts:\n      - id: insurance-contract\norganizations:\n  - mspid: InsurerMSP\n    identities:\n      certificates:\n        - name: insurerAdmin\n          clientPrivateKey:\n            path: '${containerPath(keyPath)}'\n          clientSignedCert:\n            path: '${containerPath(certPath)}'\n        - name: policyholder1\n          clientPrivateKey:\n            path: '${containerPath(policyholderKeyPath)}'\n          clientSignedCert:\n            path: '${containerPath(policyholderCertPath)}'\n    connectionProfile:\n      path: 'benchmarks/caliper/generated/connection-insurer.json'\n      discover: false\n`;
await writeFile(path.join(generated, 'network.yaml'), yaml);
console.log(path.join(generated, 'network.yaml'));
