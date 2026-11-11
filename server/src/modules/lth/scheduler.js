'use strict';

const { get, run, tx } = require('../../db');
const { nowIso } = require('../../utils/validate');
const logger = require('../../utils/logger');
const lthService = require('./service');

const JOB_NAME = 'lth_24h_rewards';

/**
 * Acquires an atomic DB lease before running the 24h reward settlement batch.
 * Safe across horizontal multi-server deployments: only the lease holder runs the batch,
 * and UNIQUE(holding_id, cycle_number) provides a second hard guarantee against duplicates.
 */
function runCoordinatedRewardTick({ nowMs = Date.now(), leaseDurationMs = 45000, instanceId = lthService.SERVER_INSTANCE_ID } = {}) {
  const acquired = tx(() => {
    const existing = get('SELECT * FROM distributed_scheduler_leases WHERE job_name = ?', [JOB_NAME]);
    const nowStr = nowIso();
    if (!existing) {
      run(
        `INSERT INTO distributed_scheduler_leases (
          job_name, holder_instance_id, leased_until_ms, last_run_at, last_cycles_settled, updated_at
        ) VALUES (?, ?, ?, NULL, 0, ?)`,
        [JOB_NAME, instanceId, nowMs + leaseDurationMs, nowStr]
      );
      return true;
    }
    if (Number(existing.leased_until_ms) <= nowMs || existing.holder_instance_id === instanceId) {
      run(
        `UPDATE distributed_scheduler_leases
         SET holder_instance_id = ?, leased_until_ms = ?, updated_at = ?
         WHERE job_name = ?`,
        [instanceId, nowMs + leaseDurationMs, nowStr, JOB_NAME]
      );
      return true;
    }
    return false;
  });

  if (!acquired) {
    return { acquired_lease: false, cycles_settled: 0, stakes_unlocked: 0, instance_id: instanceId };
  }

  const result = lthService.settleDueRewards({ nowMs, serverInstanceId: instanceId });
  const finishedStr = nowIso();
  tx(() => {
    run(
      `UPDATE distributed_scheduler_leases
       SET last_run_at = ?, last_cycles_settled = ?, updated_at = ?
       WHERE job_name = ? AND holder_instance_id = ?`,
      [finishedStr, result.cycles_settled, finishedStr, JOB_NAME, instanceId]
    );
  });

  if (result.cycles_settled > 0 || result.stakes_unlocked > 0) {
    logger.info('LTH 24h reward scheduler settled due cycles', {
      instance_id: instanceId,
      cycles_settled: result.cycles_settled,
      stakes_unlocked: result.stakes_unlocked
    });
  }

  return {
    acquired_lease: true,
    cycles_settled: result.cycles_settled,
    stakes_unlocked: result.stakes_unlocked,
    instance_id: instanceId
  };
}

function startRewardScheduler({ intervalMs = 30000 } = {}) {
  try {
    runCoordinatedRewardTick();
  } catch (err) {
    logger.warn('initial LTH reward tick skipped', { error: err.message });
  }

  const timer = setInterval(() => {
    try {
      runCoordinatedRewardTick();
    } catch (err) {
      logger.error('LTH reward scheduler tick error', { error: err.message });
    }
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  return {
    stop: () => clearInterval(timer)
  };
}

module.exports = {
  runCoordinatedRewardTick,
  startRewardScheduler
};
