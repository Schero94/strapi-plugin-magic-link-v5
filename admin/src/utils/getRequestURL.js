import { PLUGIN_ID } from '../pluginId';

const getRequestURL = (endPoint) => `/${PLUGIN_ID}/${endPoint}`;

export default getRequestURL;
