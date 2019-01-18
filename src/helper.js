import Sequelize from 'sequelize';

export const MODEL = 'MODEL';
export const ASSOCIATION = 'ASSOCIATION';
export const SEQUELIZE = 'SEQUELIZE';

export function methods(version) {
  return {
    findByPk: /^[5]/.test(version) ? ['findByPk'] :
              /^[4]/.test(version) ? ['findByPk', 'findById'] :
              ['findById', 'findByPrimary']
  };
}

export function method(target, alias) {
  if (type(target) === MODEL) {
    return methods(target.sequelize.constructor.version)[alias][0];
  }
  throw new Error('Unknown target');
}

export function type(target) {
  if (target.associationType) {
    return ASSOCIATION;
  } else if (/(SequelizeModel|class extends Model)/.test(target.toString()) || Sequelize.Model.isPrototypeOf(target)) {
    return MODEL;
  } else {
    return SEQUELIZE;
  }
}
