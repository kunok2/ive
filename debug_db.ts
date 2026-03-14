import { getAllProjects, getRolesByProject, getRoleAssignments } from './src/lib/db';

async function debug() {
  try {
    const projects = getAllProjects();
    console.log('--- Projects ---');
    projects.forEach(p => {
      console.log(`Project: ${p.name} (ID: ${p.id}, TargetLabel: ${p.labelTarget})`);
      const roles = getRolesByProject(p.id);
      console.log(`  Total Roles: ${roles.length}`);
      roles.forEach(r => {
        const assignments = getRoleAssignments(r.id);
        console.log(`    Role: ${r.name} (Category: ${r.category}, Status: ${r.status})`);
        console.log(`      Assignments Count: ${assignments.length}`);
        assignments.forEach(a => {
          console.log(`        Agent: ${a.agent.name} (Status: ${a.agent.status})`);
        });
      });
    });
  } catch (err) {
    console.error('Debug failed:', err);
  }
}

debug();
