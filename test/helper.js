import Sequelize from 'sequelize';
import {resetCache} from '../src';

beforeEach(resetCache);

export const connection = new Sequelize('dataloader_test', 'dataloader_test', 'dataloader_test', {
  dialect: 'postgres',
  host: 'db'
});

export function randint(min = 1, max = 10000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
