import Sequelize from 'sequelize';
import {resetCache} from '../src';

beforeEach(resetCache);

export const connection = new Sequelize(
  process.env.DB_DATABASE,
  process.env.DB_USER,
  process.env.DB_PASSWORD, {
    dialect: 'postgres',
    host: process.env.DB_HOST,
    logging: false
  }
);

export function randint(min = 1, max = 10000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
