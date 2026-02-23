import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export class HomeAssistantClient extends EventEmitter {
  private baseUrl: string;
  private token: string;
  private ws?: WebSocket;
  private messageId = 1;
  private isConnected = false;

  constructor(url: string, token: string) {
    super();
    this.baseUrl = url.replace(/\/$/, '');
    this.token = token;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Connection failed: ${response.statusText}`);
      }
      const data: any = await response.json();
      console.log('✅ HA connection:', data.message);
      return true;
    } catch (error) {
      console.error('❌ HA connection failed:', error);
      return false;
    }
  }

  async getVacuumEntities(): Promise<HAState[]> {
    const response = await fetch(`${this.baseUrl}/api/states`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to get states: ${response.statusText}`);
    }
    const states: HAState[] = (await response.json()) as HAState[];
    return states.filter((e) => e.entity_id.startsWith('vacuum.'));
  }

  async getEntityState(entityId: string): Promise<HAState> {
    const response = await fetch(`${this.baseUrl}/api/states/${entityId}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to get state: ${response.statusText}`);
    }
    return (await response.json()) as HAState;
  }

  async callService(domain: string, service: string, data: any = {}): Promise<any> {
    const url = `${this.baseUrl}/api/services/${domain}/${service}`;
    console.log(`[HA Client] Calling service:`);
    console.log(`   URL: ${url}`);
    console.log(`   Data: ${JSON.stringify(data)}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[HA Client] ❌ Service call failed: ${response.status} ${response.statusText}`);
      console.error(`   Response: ${errorText}`);
      throw new Error(`Service call failed: ${response.statusText} - ${errorText}`);
    }
    const result = await response.json();
    console.log(`[HA Client] ✅ Service call successful`);
    return result;
  }

  async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      this.ws = new WebSocket(`${wsUrl}/api/websocket`);
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket timeout'));
      }, 10000);
      this.ws.on('message', (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_required') {
          this.ws?.send(
            JSON.stringify({
              type: 'auth',
              access_token: this.token,
            }),
          );
        } else if (msg.type === 'auth_ok') {
          clearTimeout(timeout);
          this.isConnected = true;
          this.ws?.send(
            JSON.stringify({
              id: this.messageId++,
              type: 'subscribe_events',
              event_type: 'state_changed',
            }),
          );
          resolve();
        } else if (msg.type === 'event') {
          const event = msg.event;
          if (event.event_type === 'state_changed') {
            const entityId = event.data.entity_id;
            // Forward all state changes to allow listeners to filter
            this.emit('stateChanged', entityId, event.data.new_state);
          }
        }
      });
      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  isConnectedToWebSocket() {
    return this.isConnected;
  }
}
