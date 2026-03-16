import { getAllProjects, getProjectAssignments } from './src/lib/db';

async function debug() {
  try {
    const projects = getAllProjects();
    console.log('--- Projects ---');
    projects.forEach(p => {
      console.log(`Project: ${p.name} (ID: ${p.id}, TargetLabel: ${p.labelTarget})`);
      const agents = getProjectAssignments(p.id);
      console.log(`  Assigned Agents: ${agents.length}`);
      agents.forEach(a => {
        console.log(`    Agent: ${a.agent.name} (Status: ${a.agent.status})`);
      });
    });
  } catch (err) {
    console.error('Debug failed:', err);
  }
}

debug();
