import Sequelize from 'sequelize';

let lastInt = 1000;

export const connection = new Sequelize(
  process.env.DB_DATABASE,
  process.env.DB_USER,
  process.env.DB_PASSWORD, {
    dialect: 'postgres',
    host: process.env.DB_HOST,
    logging: false
  }
);

export function createConnection() {
  const connection = new Sequelize(
    process.env.DB_DATABASE,
    process.env.DB_USER,
    process.env.DB_PASSWORD, {
      dialect: 'postgres',
      host: process.env.DB_HOST,
      logging: false
    }
  );

  this.connection = connection;
  return connection;
}

// Having a sequential id helps with the queries with limit
export function randint() {
  lastInt += 1;
  return lastInt;
}
