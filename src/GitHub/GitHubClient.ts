import electron from 'electron';
import Logger from 'color-logger';
import _path from 'path';
import https from 'https';
import http from 'http';
import os from 'os';
import GitHubClientDeliver from './GitHubClientDeliver';
import Timer from '../Util/Timer';
import Identifier from '../Util/Identifier';

interface Response {
  body: any;
  headers: http.IncomingHttpHeaders;
  statusCode: number;
}

export default class GitHubClient {
  private readonly _accessToken: string;
  private readonly _host: string;
  private readonly _pathPrefix: string;
  private readonly _https: boolean;
  private readonly _userAgent: string;
  private readonly _name: string;

  constructor(accessToken, host, pathPrefix, https: boolean = true) {
    if (!accessToken || !host) {
      Logger.e('invalid access token or host');
      process.exit(1);
    }

    this._accessToken = accessToken;
    this._host = host;
    this._pathPrefix = pathPrefix;
    this._https = https;
    this._userAgent = this._getUserAgent();
    this._name = `GitHubClient:${Identifier.getId()}`;
  }

  requestImmediate(path: string, query?: {[key: string]: string | number}): Promise<Response> {
    return GitHubClientDeliver.pushImmediate((resolve, reject)=> {
      this._request(path, query).then(resolve).catch(reject);
    }, this._name);
  }

  request(path: string, query?: {[key: string]: string | number}): Promise<Response> {
    return GitHubClientDeliver.push((resolve, reject)=> {
      this._request(path, query).then(resolve).catch(reject);
    }, this._name);
  }

  cancel(): void {
    GitHubClientDeliver.cancel(this._name);
  }

  _request(path: string, query: {[key: string]: string | number} | undefined): Promise<Response> {
    let requestPath = _path.normalize(`/${this._pathPrefix}/${path}`);
    requestPath = requestPath.replace(/\\/g, '/'); // for windows

    if (query) {
      const queryString = Object.keys(query).map((k) => `${k}=${encodeURIComponent(query[k])}`);
      requestPath = `${requestPath}?${queryString.join('&')}`;
    }

    const options: https.RequestOptions | http.RequestOptions = {
      hostname: this._host,
      port: this._https ? 443 : 80,
      path: requestPath,
      headers: {
        'User-Agent': this._userAgent,
        'Authorization': `token ${this._accessToken}`
      }
    };

    const httpModule = this._https ? https : http;

    this._log(path, query);
    return new Promise<Response>((resolve, reject)=>{
      const req = httpModule.request(
        options,
        this._onResponse.bind(this, resolve, reject, requestPath)
      ).on('error', (e: Error) => {
        reject(e);
      });

      req.end();
    });
  }

  async _onResponse(resolve: (value?: Response | PromiseLike<Response>) => void, reject: (reason?: any) => void, path: string, res: http.IncomingMessage): Promise<void> {
    let body = '';
    const statusCode = res.statusCode;
    const headers = res.headers;

    // github.com has rate limit, but ghe does not have rate limit
    if (headers['x-ratelimit-limit']) {
      const remaining = Number(headers['x-ratelimit-remaining']);
      Logger.n(`[rate limit remaining] ${remaining} ${path}`);
      if (remaining === 0) {
        const resetTime = Number(headers['x-ratelimit-reset']) * 1000;
        const waitMilli = resetTime - Date.now();
        await Timer.sleep(waitMilli);
      }
    }

    res.setEncoding('utf8');

    res.on('data', (chunk) => body += chunk);

    res.on('end', ()=>{
      if (statusCode !== 200) {
        reject(new Error(body));
        return;
      }

      try {
        body = JSON.parse(body);
        resolve({body, statusCode, headers});
      } catch (e) {
        reject(new Error(body));
      }
    });

    res.resume();
  }

  _log(path: string, query: {[key: string]: string | number} | undefined): void {
    if (query) {
      const queryString = Object.keys(query).map((k)=> `${k}=${query[k]}`);
      Logger.n(`[request] ${path}?${queryString.join('&')}`);
    } else {
      Logger.n(`[request] ${path}`);
    }
  }

  _getUserAgent(): string {
    let version: string;
    if (electron.app) {
      version = electron.app.getVersion();
    } else {
      version = 'NaN'; // through from setup.html, electron.app is not defined
    }

    return `Jasper/${version} Node/${process.version} Electron/${process.versions.electron} ${os.type()}/${os.release()}`;
  }
}
