import { expect } from 'chai';

export const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
};

export const assertRejects = async (promise: Promise<unknown>, message?: string): Promise<Error> => {
  let rejection: unknown;
  try {
    await promise;
  } catch (error) {
    rejection = error;
  }
  expect(rejection, 'Expected promise to reject').not.to.equal(undefined);
  if (message) expect(rejection).to.be.instanceOf(Error).and.have.property('message').that.includes(message);
  return rejection as Error;
};
