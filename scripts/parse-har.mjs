import { readFileSync } from 'fs';

// Get recommendation job IDs from HAR
const har = JSON.parse(readFileSync('app.welcometothejungle.com.har', 'utf8'));
let recIds = [];
for (const entry of har.log.entries) {
  const postData = entry.request.postData?.text;
  if (!postData || !postData.includes('JobRecommendations')) continue;
  const body = entry.response.content?.text || '';
  const json = JSON.parse(body);
  recIds = json.data.currentUser.jobRecommendations.map(r => r.job.externalId);
  break;
}

// Email job IDs (from earlier SendGrid redirect test)
const emailIds = ['8iNlXCu9', '2jDFzhK5', 'TcUPp-_H'];

console.log('Recommendation IDs (10):', recIds);
console.log('Email IDs (3):', emailIds);
console.log();

const recSet = new Set(recIds);
for (const id of emailIds) {
  console.log(`  ${id}: ${recSet.has(id) ? 'IN recommendations' : 'NOT in recommendations'}`);
}

// Check HAR capture date
for (const entry of har.log.entries) {
  console.log(`\nHAR first request time: ${entry.startedDateTime}`);
  break;
}

// Check email date
const eml = readFileSync('New match_ Senior DevOps Engineer at PayZen.eml', 'utf8');
const dateMatch = eml.match(/^Date: (.+)$/m);
console.log(`Email date: ${dateMatch?.[1] || 'unknown'}`);
