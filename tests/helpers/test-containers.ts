import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import Redis from 'ioredis';

export class TestContainers {
  private static postgresContainer: StartedPostgreSqlContainer;
  private static redisContainer: StartedTestContainer;
  private static postgresPool: Pool;
  private static redisClient: Redis;

  static async startPostgres(): Promise<{ pool: Pool; container: StartedPostgreSqlContainer }> {
    if (!this.postgresContainer) {
      this.postgresContainer = await new PostgreSqlContainer('postgres:16-alpine').withExposedPorts(5432).start();

      this.postgresPool = new Pool({
        host: this.postgresContainer.getHost(),
        port: this.postgresContainer.getPort(),
        database: this.postgresContainer.getDatabase(),
        user: this.postgresContainer.getUsername(),
        password: this.postgresContainer.getPassword(),
      });

      await this.createPostgresTables();
    }

    return { pool: this.postgresPool, container: this.postgresContainer };
  }

  static async startRedis(): Promise<{ client: Redis; container: StartedTestContainer }> {
    if (!this.redisContainer) {
      this.redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

      this.redisClient = new Redis({
        host: this.redisContainer.getHost(),
        port: this.redisContainer.getMappedPort(6379),
      });
    }

    return { client: this.redisClient, container: this.redisContainer };
  }

  private static async createPostgresTables(): Promise<void> {
    await this.postgresPool.query(`
      -- Single-record approach (original)
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id VARCHAR(255) PRIMARY KEY,
        workflow_name VARCHAR(255) NOT NULL,
        group_id VARCHAR(255),
        current_state VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        data JSONB NOT NULL,
        outputs JSONB NOT NULL,
        history JSONB NOT NULL,
        metadata JSONB NOT NULL,
        suspension JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_name ON workflow_executions(workflow_name);
      CREATE INDEX IF NOT EXISTS idx_group_id ON workflow_executions(group_id);
      CREATE INDEX IF NOT EXISTS idx_status ON workflow_executions(status);
      CREATE INDEX IF NOT EXISTS idx_current_state ON workflow_executions(current_state);

      -- History-based approach (each state transition as separate record)
      CREATE TABLE IF NOT EXISTS workflow_executions_main (
        id VARCHAR(255) PRIMARY KEY,
        workflow_name VARCHAR(255) NOT NULL,
        group_id VARCHAR(255),
        current_state VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        data JSONB NOT NULL,
        outputs JSONB NOT NULL,
        metadata JSONB NOT NULL,
        suspension JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workflow_state_history (
        id SERIAL PRIMARY KEY,
        execution_id VARCHAR(255) NOT NULL REFERENCES workflow_executions_main(id) ON DELETE CASCADE,
        state_name VARCHAR(255) NOT NULL,
        from_state VARCHAR(255) NOT NULL,
        to_state VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        started_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP NOT NULL,
        duration INTEGER NOT NULL,
        error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (execution_id, state_name, started_at)
      );

      CREATE INDEX IF NOT EXISTS idx_history_execution ON workflow_state_history(execution_id);
      CREATE INDEX IF NOT EXISTS idx_history_state ON workflow_state_history(state_name);

      -- State locks table for preventing duplicate processing
      CREATE TABLE IF NOT EXISTS workflow_state_locks (
        id SERIAL PRIMARY KEY,
        execution_id VARCHAR(255) NOT NULL,
        state_name VARCHAR(255) NOT NULL,
        locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (execution_id, state_name)
      );

      CREATE INDEX IF NOT EXISTS idx_locks_execution ON workflow_state_locks(execution_id);
      CREATE INDEX IF NOT EXISTS idx_locks_locked_at ON workflow_state_locks(locked_at);
    `);
  }

  static async cleanupPostgres(): Promise<void> {
    if (this.postgresPool) {
      await this.postgresPool.query(`
        TRUNCATE workflow_executions CASCADE;
        TRUNCATE workflow_executions_main CASCADE;
        TRUNCATE workflow_state_locks CASCADE;
      `);
    }
  }

  static async cleanupRedis(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.flushall();
    }
  }

  static async stopAll(): Promise<void> {
    if (this.postgresPool) {
      await this.postgresPool.end();
    }
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    if (this.postgresContainer) {
      await this.postgresContainer.stop();
    }
    if (this.redisContainer) {
      await this.redisContainer.stop();
    }
  }
}
