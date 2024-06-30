export const edge = true;


export const headers = {
  'Some-Header': 'some value',
}

export const streaming = true;


export const isr = {
  expiration: 30,
}


export default async function handler() {
  return new Response('Edge Function: OK', {
    status: 200,
  });
}
