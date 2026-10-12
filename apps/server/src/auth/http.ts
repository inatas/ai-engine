import { Controller, Get, Post, Req, Res, Body, Inject, SetMetadata, HttpCode, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AuthService, type AuthRequest } from './service.js';

export const Public = () => SetMetadata('auth:public', true);
export class AuthGuard implements CanActivate {
  constructor(private service: AuthService, private reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) await this.service.protectMutation(request);
    const isPublic = this.reflector.getAllAndOverride<boolean>('auth:public', [context.getHandler(), context.getClass()]);
    if (!isPublic) await this.service.requirePrincipal(request);
    return true;
  }
}
@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private service: AuthService) {}
  @Public() @Get('csrf')
  async csrf(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    return { data: await this.service.csrfContext(request, response) };
  }
  @Public() @Post('register')
  async register(@Req() request: AuthRequest, @Body() body: unknown) {
    return { data: await this.service.register(request, body) };
  }
  @Public() @Post('login') @HttpCode(200)
  async login(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    return { data: await this.service.login(request, response, body) };
  }
  @Get('me')
  me(@Req() request: AuthRequest) {
    const principal = request.principal!;
    return { data: { user_id: principal.user_id, username: principal.username } };
  }
  @Post('logout') @HttpCode(200)
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    return { data: await this.service.logout(request, response, body) };
  }
}
